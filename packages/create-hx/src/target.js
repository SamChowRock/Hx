import { constants, lstatSync, mkdirSync } from 'node:fs';
import { access, link, lstat, readdir, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const defaultOperations = Object.freeze({
  createDirectory(entryPath) {
    mkdirSync(entryPath);
    return identityOf(lstatSync(entryPath));
  },
  link,
  lstat,
  readdir,
  rename,
});

function identityOf(entryStat) {
  return { dev: entryStat.dev, ino: entryStat.ino };
}

function hasIdentity(entryStat, expectedIdentity) {
  return (
    expectedIdentity !== null &&
    expectedIdentity !== undefined &&
    entryStat.dev === expectedIdentity.dev &&
    entryStat.ino === expectedIdentity.ino
  );
}

async function assertIdentity(entryPath, expectedIdentity, operations) {
  let entryStat;
  try {
    entryStat = await operations.lstat(entryPath);
  } catch {
    throw new Error('The project target changed while the scaffold was being prepared.');
  }
  if (!hasIdentity(entryStat, expectedIdentity)) {
    throw new Error('The project target changed while the scaffold was being prepared.');
  }
}

async function assertAncestorIdentities(ancestors, operations) {
  for (const ancestor of ancestors) {
    await assertIdentity(ancestor.path, ancestor.identity, operations);
  }
}

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

export async function inspectTarget(target) {
  const targetPath = path.resolve(target);
  if (path.parse(targetPath).root === targetPath) {
    throw new Error('The project target cannot be a filesystem root.');
  }

  const targetStat = await optionalLstat(targetPath);
  if (targetStat) {
    if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) {
      throw new Error('The project target must be a directory and not a symbolic link.');
    }
    if ((await readdir(targetPath)).length !== 0) {
      throw new Error(`The project target is not empty: ${targetPath}`);
    }
    await access(targetPath, constants.W_OK);
    return { targetPath, targetExisted: true, targetIdentity: identityOf(targetStat) };
  }

  const parentPath = path.dirname(targetPath);
  const parentStat = await optionalLstat(parentPath);
  if (!parentStat) {
    throw new Error(`The project target parent directory does not exist: ${parentPath}`);
  }
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new Error(`The project target parent is not a directory: ${parentPath}`);
  }
  await access(parentPath, constants.W_OK);
  return { targetPath, targetExisted: false, targetIdentity: null };
}

async function copyTree({
  sourceDirectory,
  targetDirectory,
  targetAncestors,
  operations,
  created,
  signal,
}) {
  signal?.throwIfAborted();
  await assertAncestorIdentities(targetAncestors, operations);
  const entries = await operations.readdir(sourceDirectory, { withFileTypes: true });
  await assertAncestorIdentities(targetAncestors, operations);
  entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));

  for (const entry of entries) {
    signal?.throwIfAborted();
    await assertAncestorIdentities(targetAncestors, operations);
    const sourcePath = path.join(sourceDirectory, entry.name);
    const targetPath = path.join(targetDirectory, entry.name);

    if (entry.isDirectory()) {
      const directoryIdentity = await operations.createDirectory(targetPath);
      created.push({
        path: targetPath,
        type: 'directory',
        identity: directoryIdentity,
      });
      await assertAncestorIdentities(targetAncestors, operations);
      await assertIdentity(targetPath, directoryIdentity, operations);
      await copyTree({
        sourceDirectory: sourcePath,
        targetDirectory: targetPath,
        targetAncestors: [...targetAncestors, { path: targetPath, identity: directoryIdentity }],
        operations,
        created,
        signal,
      });
    } else if (entry.isFile()) {
      const sourceIdentity = identityOf(await operations.lstat(sourcePath));
      await operations.link(sourcePath, targetPath);
      created.push({
        path: targetPath,
        type: 'file',
        identity: sourceIdentity,
      });
      await assertAncestorIdentities(targetAncestors, operations);
    } else {
      throw new Error(`Staging contains a non-file entry: ${sourcePath}`);
    }
  }
  signal?.throwIfAborted();
  await assertAncestorIdentities(targetAncestors, operations);
}

async function preserveUnrelatedRollback(entry, rollbackPath, operations) {
  if (entry.type === 'file') {
    try {
      await operations.link(rollbackPath, entry.path);
      return;
    } catch {
      // Another entry owns the original path, so preserve both under distinct names.
    }
  }

  const preservedPath = path.join(path.dirname(entry.path), `.create-hx-preserved-${randomUUID()}`);
  try {
    await operations.rename(rollbackPath, preservedPath);
  } catch {
    // Leaving data in the private rollback directory is safer than deleting it.
  }
}

async function moveCreatedEntryToRollback(entry, rollbackDirectory, operations) {
  const rollbackPath = path.join(rollbackDirectory, randomUUID());
  try {
    await operations.rename(entry.path, rollbackPath);
    const rollbackStat = await operations.lstat(rollbackPath);
    if (!hasIdentity(rollbackStat, entry.identity)) {
      await preserveUnrelatedRollback(entry, rollbackPath, operations);
    }
  } catch {
    // Rollback is best-effort and never conditionally deletes a target path.
  }
}

async function rollbackCreated(created, stagingPath, operations) {
  if (created.length === 0) {
    return null;
  }

  const rollbackDirectory = path.join(stagingPath, `.create-hx-rollback-${randomUUID()}`);
  try {
    await operations.createDirectory(rollbackDirectory);
  } catch {
    return null;
  }

  for (const entry of created.toReversed()) {
    await moveCreatedEntryToRollback(entry, rollbackDirectory, operations);
  }
  return rollbackDirectory;
}

export async function commitStaging({
  stagingPath,
  targetPath,
  targetExisted,
  targetIdentity = null,
  signal,
  operations: operationOverrides = {},
}) {
  const operations = { ...defaultOperations, ...operationOverrides };
  signal?.throwIfAborted();
  const currentTarget = await inspectTarget(targetPath);
  if (
    currentTarget.targetExisted !== targetExisted ||
    (targetExisted && !hasIdentity(currentTarget.targetIdentity, targetIdentity))
  ) {
    throw new Error('The project target changed while the scaffold was being prepared.');
  }

  const created = [];
  let createdTargetIdentity = null;
  try {
    if (!targetExisted) {
      createdTargetIdentity = await operations.createDirectory(currentTarget.targetPath);
    }
    signal?.throwIfAborted();
    const committedTargetIdentity = targetExisted ? targetIdentity : createdTargetIdentity;
    await assertIdentity(currentTarget.targetPath, committedTargetIdentity, operations);
    await copyTree({
      sourceDirectory: stagingPath,
      targetDirectory: currentTarget.targetPath,
      targetAncestors: [{ path: currentTarget.targetPath, identity: committedTargetIdentity }],
      operations,
      created,
      signal,
    });
  } catch (error) {
    let rollbackDirectory = await rollbackCreated(created, stagingPath, operations);
    if (createdTargetIdentity) {
      if (!rollbackDirectory) {
        rollbackDirectory = path.join(stagingPath, `.create-hx-rollback-${randomUUID()}`);
        try {
          await operations.createDirectory(rollbackDirectory);
        } catch {
          rollbackDirectory = null;
        }
      }
      if (rollbackDirectory) {
        await moveCreatedEntryToRollback(
          { path: currentTarget.targetPath, type: 'directory', identity: createdTargetIdentity },
          rollbackDirectory,
          operations,
        );
      }
    }
    throw error;
  }
}
