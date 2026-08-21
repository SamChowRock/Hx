import { lstat, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { extract, list } from 'tar';
import { isExcludedPath, validateManifest } from './manifest.js';

const ACCEPTED_TYPES = new Set(['File', 'OldFile', 'Directory']);
const METADATA_LIMIT = 1_048_576;
const MANIFEST_PATH = '.hx-template/manifest.json';

class ArchiveEntryValidator {
  constructor(expectedRootName) {
    this.rootName = expectedRootName ?? null;
    this.rootSeen = false;
    this.paths = new Set();
  }

  accept(entryPath, type) {
    if (typeof entryPath !== 'string' || entryPath.includes('\0')) {
      throw new Error('Archive entry contains a NUL byte or invalid path.');
    }
    if (entryPath.includes('\\')) {
      throw new Error(`Archive entry contains a Windows path separator: ${entryPath}`);
    }
    if (entryPath.startsWith('/')) {
      throw new Error(`Archive entry uses an absolute path: ${entryPath}`);
    }
    if (/^[a-zA-Z]:/.test(entryPath)) {
      throw new Error(`Archive entry uses a Windows drive path: ${entryPath}`);
    }

    const normalized = type === 'Directory' ? entryPath.replace(/\/+$/, '') : entryPath;
    const parts = normalized.split('/');
    if (parts.some((part) => part === '.' || part === '..')) {
      throw new Error(`Archive entry attempts path traversal: ${entryPath}`);
    }
    if (parts.some((part) => part === '')) {
      throw new Error(`Archive entry contains an empty path segment: ${entryPath}`);
    }

    const [rootName, ...repositoryParts] = parts;
    if (!this.rootName) {
      this.rootName = rootName;
    }
    if (rootName !== this.rootName) {
      throw new Error(`Archive entries do not share one common root: ${entryPath}`);
    }
    if (!ACCEPTED_TYPES.has(type)) {
      throw new Error(`Archive entry type is not allowed: ${type}`);
    }

    if (repositoryParts.length === 0) {
      if (type !== 'Directory') {
        throw new Error(`Archive entry has an empty repository path: ${entryPath}`);
      }
      if (this.rootSeen) {
        throw new Error(`Duplicate archive path: ${entryPath}`);
      }
      this.rootSeen = true;
      return null;
    }

    const repositoryPath = repositoryParts.join('/');
    if (this.paths.has(repositoryPath)) {
      throw new Error(`Duplicate archive path: ${repositoryPath}`);
    }
    this.paths.add(repositoryPath);
    return repositoryPath;
  }

  finish() {
    if (!this.rootName) {
      throw new Error('Archive has no common root directory.');
    }
    return this.rootName;
  }
}

function isRegularFileType(type) {
  return type === 'File' || type === 'OldFile';
}

function readEntryBuffer(entry, repositoryPath) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    entry.on('data', (chunk) => {
      size += chunk.length;
      if (size > METADATA_LIMIT) {
        reject(new Error(`Template metadata exceeds 1 MiB: ${repositoryPath}`));
        entry.resume();
        return;
      }
      chunks.push(chunk);
    });
    entry.once('end', () => resolve([repositoryPath, Buffer.concat(chunks)]));
    entry.once('error', reject);
  });
}

function decodeUtf8(buffer, repositoryPath) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new Error(`Template metadata is not valid UTF-8: ${repositoryPath}`);
  }
}

export async function inspectTemplateArchive(archivePath) {
  const validator = new ArchiveEntryValidator();
  const metadataReads = [];
  let scanError;

  await list({
    file: archivePath,
    strict: true,
    noResume: true,
    maxMetaEntrySize: METADATA_LIMIT,
    onReadEntry(entry) {
      if (scanError) {
        entry.resume();
        return;
      }

      try {
        const repositoryPath = validator.accept(entry.path, entry.type);
        if (
          repositoryPath &&
          isRegularFileType(entry.type) &&
          (repositoryPath === '.hx-template' || repositoryPath.startsWith('.hx-template/'))
        ) {
          if (entry.size > METADATA_LIMIT) {
            throw new Error(`Template metadata exceeds 1 MiB: ${repositoryPath}`);
          }
          metadataReads.push(readEntryBuffer(entry, repositoryPath));
        } else {
          entry.resume();
        }
      } catch (error) {
        scanError = error;
        entry.resume();
      }
    },
  });

  if (scanError) {
    throw scanError;
  }

  const metadata = new Map(await Promise.all(metadataReads));
  const manifestBuffer = metadata.get(MANIFEST_PATH);
  if (!manifestBuffer) {
    throw new Error(`Archive is missing ${MANIFEST_PATH}.`);
  }

  let manifestValue;
  try {
    manifestValue = JSON.parse(decodeUtf8(manifestBuffer, MANIFEST_PATH));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Template manifest is not valid JSON: ${error.message}`);
    }
    throw error;
  }
  const manifest = validateManifest(manifestValue);
  const overlays = new Map();

  for (const source of Object.values(manifest.overrides)) {
    const buffer = metadata.get(source);
    if (!buffer) {
      throw new Error(`Archive is missing template overlay: ${source}`);
    }
    overlays.set(source, decodeUtf8(buffer, source));
  }

  return { rootName: validator.finish(), manifest, overlays };
}

async function assertOrdinaryTree(directory) {
  for (const name of await readdir(directory)) {
    const entryPath = path.join(directory, name);
    const entryStat = await lstat(entryPath);
    if (entryStat.isDirectory()) {
      await assertOrdinaryTree(entryPath);
    } else if (!entryStat.isFile()) {
      throw new Error(`Extracted template contains a non-file entry: ${entryPath}`);
    }
  }
}

export async function extractTemplateArchive({ archivePath, stagingPath, rootName, manifest }) {
  await mkdir(stagingPath, { recursive: true });
  const validator = new ArchiveEntryValidator(rootName);
  let extractionError;

  await extract({
    file: archivePath,
    cwd: stagingPath,
    strip: 1,
    preserveOwner: false,
    strict: true,
    chmod: true,
    filter(archiveEntryPath, entry) {
      if (extractionError) {
        return false;
      }
      try {
        const repositoryPath = validator.accept(archiveEntryPath, entry.type);
        return repositoryPath !== null && !isExcludedPath(repositoryPath, manifest);
      } catch (error) {
        extractionError = error;
        return false;
      }
    },
  });

  if (extractionError) {
    throw extractionError;
  }

  validator.finish();
  await assertOrdinaryTree(stagingPath);
}
