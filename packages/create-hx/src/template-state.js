import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { validateProjectName } from './arguments.js';
import { UsageError } from './errors.js';

export const LOCK_FILE_NAME = '.hx-template-lock.json';
export const TEMPLATE_SOURCE = Object.freeze({
  repository: 'SamChowRock/Hx',
  ref: 'main',
});

const TOP_LEVEL_FIELDS = new Set([
  'schemaVersion',
  'source',
  'projectName',
  'templateDigest',
  'files',
]);
const SOURCE_FIELDS = new Set(['repository', 'ref']);
const FINGERPRINT_FIELDS = new Set(['sha256', 'executable']);
const SHA256 = /^[a-f0-9]{64}$/;

function isPlainObject(value) {
  return (
    value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
  );
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) {
    throw new UsageError(`${label} must be a plain object.`);
  }
}

function assertOnlyFields(value, allowedFields, label) {
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) {
      throw new UsageError(`Unknown ${label} field: ${field}`);
    }
  }
}

function comparePaths(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isReservedPath(repositoryPath) {
  return (
    repositoryPath === LOCK_FILE_NAME ||
    repositoryPath.startsWith(`${LOCK_FILE_NAME}/`) ||
    repositoryPath === '.hx-update' ||
    repositoryPath.startsWith('.hx-update/')
  );
}

function assertStatePath(value) {
  if (
    value.length === 0 ||
    value.includes('\\') ||
    value.startsWith('/') ||
    /^[a-zA-Z]:/.test(value) ||
    value.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new UsageError(
      `Template state path must be a normalized repository-relative path: ${value}`,
    );
  }
  if (isReservedPath(value)) {
    throw new UsageError(`Template state path is reserved: ${value}`);
  }
}

function digestFiles(files) {
  return createHash('sha256').update(JSON.stringify(files)).digest('hex');
}

function copySource(value) {
  assertPlainObject(value, 'Template state source');
  assertOnlyFields(value, SOURCE_FIELDS, 'source');
  if (
    value.repository !== TEMPLATE_SOURCE.repository ||
    value.ref !== TEMPLATE_SOURCE.ref ||
    Object.keys(value).length !== SOURCE_FIELDS.size
  ) {
    throw new UsageError('Template state source must be SamChowRock/Hx at ref main.');
  }
  return Object.freeze({ ...TEMPLATE_SOURCE });
}

function copyFingerprint(value, repositoryPath) {
  assertPlainObject(value, `Template state fingerprint for ${repositoryPath}`);
  assertOnlyFields(value, FINGERPRINT_FIELDS, 'file fingerprint');
  if (Object.keys(value).length !== FINGERPRINT_FIELDS.size || !SHA256.test(value.sha256)) {
    throw new UsageError(`Template state SHA-256 is invalid for ${repositoryPath}.`);
  }
  if (typeof value.executable !== 'boolean') {
    throw new UsageError(`Template state executable flag is invalid for ${repositoryPath}.`);
  }
  return Object.freeze({ sha256: value.sha256, executable: value.executable });
}

function copyFiles(value) {
  assertPlainObject(value, 'Template state files');
  const paths = Object.keys(value);
  const sortedPaths = [...paths].sort(comparePaths);
  if (!paths.every((repositoryPath, index) => repositoryPath === sortedPaths[index])) {
    throw new UsageError('Template state file paths must be sorted.');
  }

  const files = {};
  for (const repositoryPath of paths) {
    assertStatePath(repositoryPath);
    files[repositoryPath] = copyFingerprint(value[repositoryPath], repositoryPath);
  }
  return Object.freeze(files);
}

function validateTemplateState(value) {
  assertPlainObject(value, 'Template state');
  assertOnlyFields(value, TOP_LEVEL_FIELDS, 'template state');
  if (Object.keys(value).length !== TOP_LEVEL_FIELDS.size) {
    throw new UsageError('Template state is missing required fields.');
  }
  if (value.schemaVersion !== 1) {
    throw new UsageError(`Unsupported template state schemaVersion: ${value.schemaVersion}`);
  }

  const source = copySource(value.source);
  const projectName = validateProjectName(value.projectName);
  const files = copyFiles(value.files);
  if (!SHA256.test(value.templateDigest)) {
    throw new UsageError('Template state digest must be a lowercase SHA-256 hash.');
  }
  if (value.templateDigest !== digestFiles(files)) {
    throw new UsageError('Template state digest does not match its files.');
  }

  return Object.freeze({
    schemaVersion: 1,
    source,
    projectName,
    templateDigest: value.templateDigest,
    files,
  });
}

export async function fileFingerprint(filePath) {
  let fileStat;
  try {
    fileStat = await lstat(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
    throw new Error(`Template state only supports regular files: ${filePath}`);
  }
  const contents = await readFile(filePath);
  return {
    sha256: createHash('sha256').update(contents).digest('hex'),
    executable: (fileStat.mode & 0o111) !== 0,
  };
}

export async function scanTemplateState(rootPath, { projectName }) {
  validateProjectName(projectName);
  const discoveredFiles = {};

  async function walk(directory, relativeDirectory = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => comparePaths(left.name, right.name));
    for (const entry of entries) {
      const repositoryPath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (isReservedPath(repositoryPath)) {
        continue;
      }

      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath, repositoryPath);
      } else if (entry.isFile()) {
        discoveredFiles[repositoryPath] = await fileFingerprint(entryPath);
      } else {
        throw new Error(`Template state only supports regular files and directories: ${entryPath}`);
      }
    }
  }

  await walk(rootPath);
  const files = {};
  for (const repositoryPath of Object.keys(discoveredFiles).sort(comparePaths)) {
    files[repositoryPath] = discoveredFiles[repositoryPath];
  }
  return validateTemplateState({
    schemaVersion: 1,
    source: TEMPLATE_SOURCE,
    projectName,
    templateDigest: digestFiles(files),
    files,
  });
}

export function parseTemplateState(jsonText) {
  let value;
  try {
    value = JSON.parse(jsonText);
  } catch (error) {
    throw new UsageError(`Template state is not valid JSON: ${error.message}`);
  }
  return validateTemplateState(value);
}

export function serializeTemplateState(state) {
  const validated = validateTemplateState(state);
  return `${JSON.stringify(validated, null, 2)}\n`;
}
