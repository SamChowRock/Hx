import { lstat, mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extractTemplateArchive, inspectTemplateArchive } from './archive.js';
import { downloadToFile } from './download.js';
import { isExcludedPath } from './manifest.js';
import { commitStaging, inspectTarget } from './target.js';
import { applyTemplateTransforms } from './transform.js';

export const HX_MAIN_ARCHIVE_URL =
  'https://codeload.github.com/SamChowRock/Hx/tar.gz/refs/heads/main';

async function optionalLstat(entryPath) {
  try {
    return await lstat(entryPath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function verifyOutput(stagingPath, manifest) {
  for (const repositoryPath of manifest.required) {
    const requiredPath = path.join(stagingPath, ...repositoryPath.split('/'));
    const requiredStat = await optionalLstat(requiredPath);
    if (!requiredStat?.isFile()) {
      throw new Error(`Generated scaffold is missing required file: ${repositoryPath}`);
    }
  }

  for (const excludedPath of manifest.exclude) {
    const outputPath = path.join(stagingPath, ...excludedPath.split('/'));
    if (await optionalLstat(outputPath)) {
      throw new Error(`Generated scaffold contains excluded path: ${excludedPath}`);
    }
  }

  async function walk(directory, relativeDirectory = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const repositoryPath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (isExcludedPath(repositoryPath, manifest)) {
        throw new Error(`Generated scaffold contains excluded path: ${repositoryPath}`);
      }
      if (entry.isDirectory()) {
        await walk(path.join(directory, entry.name), repositoryPath);
      }
    }
  }

  await walk(stagingPath);
}

export async function createProject({
  targetPath,
  projectName,
  signal,
  sourceUrl = HX_MAIN_ARCHIVE_URL,
  downloadOptions = {},
  temporaryDirectory = os.tmpdir(),
  downloadImpl = downloadToFile,
}) {
  signal?.throwIfAborted();
  const target = await inspectTarget(targetPath);
  signal?.throwIfAborted();
  const stagingPath = await mkdtemp(
    path.join(path.dirname(target.targetPath), '.create-hx-stage-'),
  );
  let downloadDirectory;

  try {
    downloadDirectory = await mkdtemp(path.join(temporaryDirectory, 'create-hx-download-'));
    const archivePath = path.join(downloadDirectory, 'hx-main.tgz');
    await downloadImpl({
      ...downloadOptions,
      url: sourceUrl,
      destination: archivePath,
      signal,
    });
    signal?.throwIfAborted();
    const template = await inspectTemplateArchive(archivePath);
    signal?.throwIfAborted();
    await extractTemplateArchive({
      archivePath,
      stagingPath,
      rootName: template.rootName,
      manifest: template.manifest,
    });
    signal?.throwIfAborted();
    await applyTemplateTransforms({
      stagingPath,
      projectName,
      manifest: template.manifest,
      overlays: template.overlays,
    });
    signal?.throwIfAborted();
    await verifyOutput(stagingPath, template.manifest);
    signal?.throwIfAborted();
    await commitStaging({
      stagingPath,
      targetPath: target.targetPath,
      targetExisted: target.targetExisted,
      targetIdentity: target.targetIdentity,
      signal,
    });
  } finally {
    await rm(stagingPath, { recursive: true, force: true });
    if (downloadDirectory) {
      await rm(downloadDirectory, { recursive: true, force: true });
    }
  }
}
