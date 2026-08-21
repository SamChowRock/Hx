import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  access,
  chmod,
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  rename,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { validateProjectName } from './arguments.js';
import {
  LOCK_FILE_NAME,
  fileFingerprint,
  parseTemplateState,
  serializeTemplateState,
} from './template-state.js';

export const ADOPTION_ANCHORS = Object.freeze([
  'package.json',
  'apps/api/src/main.ts',
  'apps/worker/src/main.ts',
  'docker-compose.yml',
  'prisma/schema.prisma',
]);

function identityOf(entryStat) {
  return Object.freeze({ dev: entryStat.dev, ino: entryStat.ino });
}

function hasIdentity(entryStat, expectedIdentity) {
  return entryStat.dev === expectedIdentity.dev && entryStat.ino === expectedIdentity.ino;
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

async function assertRootIdentity(target) {
  const rootStat = await optionalLstat(target.targetPath);
  if (
    !rootStat ||
    !rootStat.isDirectory() ||
    rootStat.isSymbolicLink() ||
    !hasIdentity(rootStat, target.rootIdentity)
  ) {
    throw new Error('The project root changed while its update state was being inspected.');
  }
}

async function inspectRepositoryEntry(rootPath, repositoryPath) {
  const parts = repositoryPath.split('/');
  let entryPath = rootPath;
  for (let index = 0; index < parts.length; index += 1) {
    entryPath = path.join(entryPath, parts[index]);
    const entryStat = await optionalLstat(entryPath);
    if (!entryStat) {
      return null;
    }
    if (index < parts.length - 1) {
      if (!entryStat.isDirectory() || entryStat.isSymbolicLink()) {
        throw new Error(`Project path has an unsafe ancestor: ${repositoryPath}`);
      }
    } else {
      return { entryPath, entryStat };
    }
  }
  return null;
}

async function readRegularFile(rootPath, repositoryPath) {
  const inspected = await inspectRepositoryEntry(rootPath, repositoryPath);
  if (!inspected?.entryStat.isFile() || inspected.entryStat.isSymbolicLink()) {
    throw new Error(`Project path must be a regular file: ${repositoryPath}`);
  }

  let fileHandle;
  try {
    fileHandle = await open(inspected.entryPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const openedStat = await fileHandle.stat();
    if (!openedStat.isFile() || !hasIdentity(openedStat, identityOf(inspected.entryStat))) {
      throw new Error(`Project path changed while it was being read: ${repositoryPath}`);
    }
    return await fileHandle.readFile('utf8');
  } finally {
    await fileHandle?.close();
  }
}

async function readPackageName(rootPath) {
  let packageJson;
  try {
    packageJson = JSON.parse(await readRegularFile(rootPath, 'package.json'));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Project package.json is not valid JSON: ${error.message}`);
    }
    throw error;
  }
  if (
    packageJson === null ||
    typeof packageJson !== 'object' ||
    Array.isArray(packageJson) ||
    typeof packageJson.name !== 'string'
  ) {
    throw new Error('Project package.json must contain a string name.');
  }
  return validateProjectName(packageJson.name);
}

async function assertNotSourceRepository(rootPath) {
  const templateMetadata = await inspectRepositoryEntry(rootPath, '.hx-template');
  const createHxPackage = await inspectRepositoryEntry(rootPath, 'packages/create-hx');
  if (templateMetadata || createHxPackage) {
    throw new Error('Refusing to update the Hx source repository as a generated project.');
  }
}

async function assertConflictWorkspaceAvailable(rootPath) {
  const workspace = await optionalLstat(path.join(rootPath, '.hx-update'));
  if (!workspace) {
    return;
  }
  if (!workspace.isDirectory() || workspace.isSymbolicLink()) {
    throw new Error('The project .hx-update path must be an empty directory.');
  }
  if ((await readdir(path.join(rootPath, '.hx-update'))).length !== 0) {
    throw new Error('Resolve or remove the existing .hx-update workspace before updating again.');
  }
}

export async function inspectUpdateTarget(target) {
  const targetPath = path.resolve(target);
  if (path.parse(targetPath).root === targetPath) {
    throw new Error('The update target cannot be a filesystem root.');
  }

  const targetStat = await optionalLstat(targetPath);
  if (!targetStat?.isDirectory() || targetStat.isSymbolicLink()) {
    throw new Error('The update target must be a directory and not a symbolic link.');
  }
  await access(targetPath, constants.W_OK);
  const rootIdentity = identityOf(targetStat);
  const identityTarget = { targetPath, rootIdentity };

  await assertConflictWorkspaceAvailable(targetPath);
  await assertNotSourceRepository(targetPath);

  const packageName = await readPackageName(targetPath);
  const lockEntry = await inspectRepositoryEntry(targetPath, LOCK_FILE_NAME);
  let baseline = null;
  let adoption = true;
  let projectName = packageName;

  if (lockEntry) {
    baseline = parseTemplateState(await readRegularFile(targetPath, LOCK_FILE_NAME));
    adoption = false;
    projectName = baseline.projectName;
  } else {
    for (const anchor of ADOPTION_ANCHORS) {
      const entry = await inspectRepositoryEntry(targetPath, anchor);
      if (!entry?.entryStat.isFile() || entry.entryStat.isSymbolicLink()) {
        throw new Error(
          `A lockless update target must be a create-hx 0.1 project with anchor ${anchor}.`,
        );
      }
    }
  }

  await assertRootIdentity(identityTarget);
  return Object.freeze({
    targetPath,
    rootIdentity,
    projectName,
    packageName,
    baseline,
    adoption,
  });
}

async function controlledFingerprint(rootPath, repositoryPath) {
  const inspected = await inspectRepositoryEntry(rootPath, repositoryPath);
  if (!inspected) {
    return null;
  }
  if (!inspected.entryStat.isFile() || inspected.entryStat.isSymbolicLink()) {
    throw new Error(`Controlled project path must be a regular file: ${repositoryPath}`);
  }
  return fileFingerprint(inspected.entryPath);
}

export async function collectControlledState(target, incomingState) {
  const validatedIncoming = parseTemplateState(JSON.stringify(incomingState));
  await assertRootIdentity(target);
  const controlledPaths = new Set([
    ...Object.keys(target.baseline?.files ?? {}),
    ...Object.keys(validatedIncoming.files),
  ]);
  const localFiles = {};
  for (const repositoryPath of [...controlledPaths].sort((left, right) =>
    left.localeCompare(right, 'en'),
  )) {
    localFiles[repositoryPath] = await controlledFingerprint(target.targetPath, repositoryPath);
  }
  await assertRootIdentity(target);
  return Object.freeze(localFiles);
}

const defaultTransactionOperations = Object.freeze({
  chmod,
  checkpoint() {},
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  rename,
  rm,
  rmdir,
  writeFile,
});

function fingerprintsEqual(left, right) {
  return (
    left !== null &&
    right !== null &&
    left.sha256 === right.sha256 &&
    left.executable === right.executable
  );
}

async function optionalOperationLstat(entryPath, operations) {
  try {
    return await operations.lstat(entryPath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function assertTransactionRoot(target, operations) {
  const rootStat = await optionalOperationLstat(target.targetPath, operations);
  if (
    !rootStat ||
    !rootStat.isDirectory() ||
    rootStat.isSymbolicLink() ||
    !hasIdentity(rootStat, target.rootIdentity)
  ) {
    throw new Error('The project root changed while the template update was being applied.');
  }
}

async function inspectTransactionPath(rootPath, repositoryPath, operations) {
  const parts = repositoryPath.split('/');
  let entryPath = rootPath;
  for (let index = 0; index < parts.length; index += 1) {
    entryPath = path.join(entryPath, parts[index]);
    const entryStat = await optionalOperationLstat(entryPath, operations);
    if (!entryStat) {
      return null;
    }
    if (index < parts.length - 1) {
      if (!entryStat.isDirectory() || entryStat.isSymbolicLink()) {
        throw new Error(`Update path has an unsafe ancestor: ${repositoryPath}`);
      }
    } else {
      return { entryPath, entryStat };
    }
  }
  return null;
}

async function ensureDirectory(directoryPath, operations) {
  await operations.mkdir(directoryPath, { recursive: true });
}

async function prepareIncomingFile({
  templatePath,
  repositoryPath,
  destinationPath,
  expected,
  operations,
}) {
  const source = await inspectTransactionPath(templatePath, repositoryPath, operations);
  if (!source?.entryStat.isFile() || source.entryStat.isSymbolicLink()) {
    throw new Error(`Incoming template path must be a regular file: ${repositoryPath}`);
  }
  const sourceFingerprint = await fileFingerprint(source.entryPath);
  if (!fingerprintsEqual(sourceFingerprint, expected)) {
    throw new Error(`Incoming template path changed while preparing: ${repositoryPath}`);
  }

  await ensureDirectory(path.dirname(destinationPath), operations);
  await operations.copyFile(source.entryPath, destinationPath, constants.COPYFILE_EXCL);
  await operations.chmod(destinationPath, expected.executable ? 0o755 : 0o644);
  const preparedFingerprint = await fileFingerprint(destinationPath);
  if (!fingerprintsEqual(preparedFingerprint, expected)) {
    throw new Error(`Prepared update file does not match the incoming state: ${repositoryPath}`);
  }
}

async function createTargetDirectories({ target, repositoryPath, operations, createdDirectories }) {
  const parts = repositoryPath.split('/').slice(0, -1);
  let directoryPath = target.targetPath;
  for (const part of parts) {
    await assertTransactionRoot(target, operations);
    directoryPath = path.join(directoryPath, part);
    const current = await optionalOperationLstat(directoryPath, operations);
    if (current) {
      if (!current.isDirectory() || current.isSymbolicLink()) {
        throw new Error(`Update path has an unsafe directory: ${repositoryPath}`);
      }
      continue;
    }

    try {
      await operations.mkdir(directoryPath);
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }
    }
    const createdStat = await optionalOperationLstat(directoryPath, operations);
    if (!createdStat?.isDirectory() || createdStat.isSymbolicLink()) {
      throw new Error(`Update directory changed while it was being created: ${repositoryPath}`);
    }
    createdDirectories.push({
      path: directoryPath,
      identity: identityOf(createdStat),
    });
  }
}

async function installPreparedFile({
  target,
  repositoryPath,
  preparedPath,
  expected,
  operations,
  installed,
  createdDirectories,
}) {
  await createTargetDirectories({
    target,
    repositoryPath,
    operations,
    createdDirectories,
  });
  await assertTransactionRoot(target, operations);
  const targetPath = path.join(target.targetPath, ...repositoryPath.split('/'));
  if (await optionalOperationLstat(targetPath, operations)) {
    throw new Error(`Update path appeared before it could be installed: ${repositoryPath}`);
  }

  const preparedStat = await operations.lstat(preparedPath);
  await operations.link(preparedPath, targetPath);
  const installedStat = await operations.lstat(targetPath);
  if (!hasIdentity(installedStat, identityOf(preparedStat))) {
    throw new Error(`Update path changed while it was being installed: ${repositoryPath}`);
  }
  const installedFingerprint = await fileFingerprint(targetPath);
  if (!fingerprintsEqual(installedFingerprint, expected)) {
    throw new Error(`Installed update path has unexpected contents: ${repositoryPath}`);
  }
  installed.push({
    path: repositoryPath,
    targetPath,
    identity: identityOf(installedStat),
    fingerprint: expected,
  });
}

async function backupTargetFile({
  target,
  repositoryPath,
  expected,
  backupRoot,
  operations,
  backups,
}) {
  await assertTransactionRoot(target, operations);
  const inspected = await inspectTransactionPath(target.targetPath, repositoryPath, operations);
  if (!inspected?.entryStat.isFile() || inspected.entryStat.isSymbolicLink()) {
    throw new Error(`Update path is no longer a regular file: ${repositoryPath}`);
  }
  const initialIdentity = identityOf(inspected.entryStat);
  const initialFingerprint = await fileFingerprint(inspected.entryPath);
  const recheckedStat = await operations.lstat(inspected.entryPath);
  if (
    !hasIdentity(recheckedStat, initialIdentity) ||
    !fingerprintsEqual(initialFingerprint, expected)
  ) {
    throw new Error(`Update path changed before backup: ${repositoryPath}`);
  }

  await operations.checkpoint('before-backup', { path: repositoryPath });
  const backupPath = path.join(backupRoot, ...repositoryPath.split('/'));
  await ensureDirectory(path.dirname(backupPath), operations);
  await operations.rename(inspected.entryPath, backupPath);
  const backupStat = await operations.lstat(backupPath);
  const backupFingerprint = await fileFingerprint(backupPath);
  backups.push({
    path: repositoryPath,
    targetPath: inspected.entryPath,
    backupPath,
    identity: identityOf(backupStat),
    fingerprint: backupFingerprint,
  });
  if (
    !hasIdentity(backupStat, initialIdentity) ||
    !fingerprintsEqual(backupFingerprint, expected)
  ) {
    throw new Error(`Update path changed while it was being backed up: ${repositoryPath}`);
  }
}

async function installPlanPaths({
  paths,
  target,
  preparedRoot,
  incomingState,
  operations,
  installed,
  createdDirectories,
}) {
  for (const repositoryPath of paths) {
    await installPreparedFile({
      target,
      repositoryPath,
      preparedPath: path.join(preparedRoot, ...repositoryPath.split('/')),
      expected: incomingState.files[repositoryPath],
      operations,
      installed,
      createdDirectories,
    });
  }
}

async function rollbackInstalledEntry(entry, transactionPath, target, operations, issues) {
  await operations.checkpoint('before-rollback-installed', { path: entry.path });
  const current = await optionalOperationLstat(entry.targetPath, operations);
  const currentFingerprint = current?.isFile() ? await fileFingerprint(entry.targetPath) : null;
  if (
    !current ||
    !hasIdentity(current, entry.identity) ||
    !fingerprintsEqual(currentFingerprint, entry.fingerprint)
  ) {
    issues.push(`A concurrently changed path was preserved: ${entry.path}`);
    return;
  }

  const quarantinePath = path.join(transactionPath, 'quarantine', randomUUID());
  await operations.rename(entry.targetPath, quarantinePath);
  const quarantined = await operations.lstat(quarantinePath);
  const quarantinedFingerprint = await fileFingerprint(quarantinePath);
  if (
    !hasIdentity(quarantined, entry.identity) ||
    !fingerprintsEqual(quarantinedFingerprint, entry.fingerprint)
  ) {
    try {
      await operations.link(quarantinePath, entry.targetPath);
    } catch {
      const preservedPath = path.join(target.targetPath, `.create-hx-preserved-${randomUUID()}`);
      await operations.link(quarantinePath, preservedPath);
    }
    issues.push(`A rollback race was preserved for: ${entry.path}`);
  }
}

async function restoreBackup(entry, target, operations, issues) {
  const backupStat = await optionalOperationLstat(entry.backupPath, operations);
  const backupFingerprint = backupStat?.isFile() ? await fileFingerprint(entry.backupPath) : null;
  if (
    !backupStat ||
    !hasIdentity(backupStat, entry.identity) ||
    !fingerprintsEqual(backupFingerprint, entry.fingerprint)
  ) {
    issues.push(`A backup changed before it could be restored: ${entry.path}`);
    return;
  }

  if (!(await optionalOperationLstat(entry.targetPath, operations))) {
    try {
      await operations.link(entry.backupPath, entry.targetPath);
      return;
    } catch {
      // A concurrent entry now owns the original path; preserve the backup below.
    }
  }

  const preservedPath = path.join(target.targetPath, `.create-hx-preserved-${randomUUID()}`);
  await operations.link(entry.backupPath, preservedPath);
  issues.push(`The original file was preserved at ${path.basename(preservedPath)}: ${entry.path}`);
}

async function rollbackTransaction({
  transactionPath,
  target,
  operations,
  installed,
  backups,
  createdDirectories,
}) {
  const issues = [];
  for (const entry of installed.toReversed()) {
    try {
      await rollbackInstalledEntry(entry, transactionPath, target, operations, issues);
    } catch (error) {
      issues.push(`Could not quarantine ${entry.path}: ${error.message}`);
    }
  }
  for (const entry of backups.toReversed()) {
    try {
      await restoreBackup(entry, target, operations, issues);
    } catch (error) {
      issues.push(`Could not restore ${entry.path}: ${error.message}`);
    }
  }
  for (const directory of createdDirectories.toReversed()) {
    try {
      const current = await optionalOperationLstat(directory.path, operations);
      if (current && hasIdentity(current, directory.identity)) {
        await operations.rmdir(directory.path);
      }
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error?.code)) {
        issues.push(`Could not remove update directory ${directory.path}: ${error.message}`);
      }
    }
  }
  return issues;
}

async function pruneDeletedDirectories(targetPath, deletedPaths, operations) {
  const candidates = new Set();
  for (const repositoryPath of deletedPaths) {
    let directory = path.dirname(path.join(targetPath, ...repositoryPath.split('/')));
    while (directory !== targetPath && directory.startsWith(`${targetPath}${path.sep}`)) {
      candidates.add(directory);
      directory = path.dirname(directory);
    }
  }
  const deepestFirst = [...candidates].sort(
    (left, right) => right.split(path.sep).length - left.split(path.sep).length,
  );
  for (const directory of deepestFirst) {
    try {
      await operations.rmdir(directory);
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error?.code)) {
        throw error;
      }
    }
  }
}

export async function commitTemplateUpdate({
  target,
  templatePath,
  incomingState,
  plan,
  signal,
  operations: operationOverrides = {},
}) {
  const operations = { ...defaultTransactionOperations, ...operationOverrides };
  const validatedIncoming = parseTemplateState(JSON.stringify(incomingState));
  signal?.throwIfAborted();
  await assertTransactionRoot(target, operations);

  const transactionPath = await operations.mkdtemp(
    path.join(path.dirname(target.targetPath), '.create-hx-update-'),
  );
  const preparedProjectRoot = path.join(transactionPath, 'prepared-project');
  const preparedConflictRoot = path.join(transactionPath, 'prepared-conflicts');
  const backupRoot = path.join(transactionPath, 'backup');
  await Promise.all([
    ensureDirectory(preparedProjectRoot, operations),
    ensureDirectory(preparedConflictRoot, operations),
    ensureDirectory(backupRoot, operations),
    ensureDirectory(path.join(transactionPath, 'quarantine'), operations),
  ]);

  const installed = [];
  const backups = [];
  const createdDirectories = [];
  let committed = false;

  try {
    for (const repositoryPath of [...plan.add, ...plan.replace]) {
      await prepareIncomingFile({
        templatePath,
        repositoryPath,
        destinationPath: path.join(preparedProjectRoot, ...repositoryPath.split('/')),
        expected: validatedIncoming.files[repositoryPath],
        operations,
      });
    }
    for (const conflict of plan.conflicts) {
      await prepareIncomingFile({
        templatePath,
        repositoryPath: conflict.path,
        destinationPath: path.join(preparedConflictRoot, ...conflict.path.split('/')),
        expected: validatedIncoming.files[conflict.path],
        operations,
      });
    }

    const preparedLockPath = path.join(transactionPath, 'incoming-lock.json');
    await operations.writeFile(preparedLockPath, serializeTemplateState(validatedIncoming), {
      encoding: 'utf8',
      mode: 0o644,
      flag: 'wx',
    });
    const lockFingerprint = await fileFingerprint(preparedLockPath);

    let preparedReportPath = null;
    let reportFingerprint = null;
    if (plan.conflicts.length > 0) {
      preparedReportPath = path.join(transactionPath, 'report.json');
      const report = {
        schemaVersion: 1,
        source: validatedIncoming.source,
        projectName: validatedIncoming.projectName,
        templateDigest: validatedIncoming.templateDigest,
        conflicts: plan.conflicts,
      };
      await operations.writeFile(preparedReportPath, `${JSON.stringify(report, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o644,
        flag: 'wx',
      });
      reportFingerprint = await fileFingerprint(preparedReportPath);
    }

    signal?.throwIfAborted();
    await installPlanPaths({
      paths: plan.add,
      target,
      preparedRoot: preparedProjectRoot,
      incomingState: validatedIncoming,
      operations,
      installed,
      createdDirectories,
    });
    await operations.checkpoint('after-add', {});
    signal?.throwIfAborted();

    for (const repositoryPath of plan.replace) {
      await backupTargetFile({
        target,
        repositoryPath,
        expected: target.baseline.files[repositoryPath],
        backupRoot,
        operations,
        backups,
      });
      await installPlanPaths({
        paths: [repositoryPath],
        target,
        preparedRoot: preparedProjectRoot,
        incomingState: validatedIncoming,
        operations,
        installed,
        createdDirectories,
      });
    }
    await operations.checkpoint('after-replace', {});
    signal?.throwIfAborted();

    for (const repositoryPath of plan.delete) {
      await backupTargetFile({
        target,
        repositoryPath,
        expected: target.baseline.files[repositoryPath],
        backupRoot,
        operations,
        backups,
      });
    }
    await operations.checkpoint('after-delete', {});
    signal?.throwIfAborted();

    for (const conflict of plan.conflicts) {
      await installPreparedFile({
        target,
        repositoryPath: `.hx-update/incoming/${conflict.path}`,
        preparedPath: path.join(preparedConflictRoot, ...conflict.path.split('/')),
        expected: validatedIncoming.files[conflict.path],
        operations,
        installed,
        createdDirectories,
      });
    }
    if (preparedReportPath) {
      await installPreparedFile({
        target,
        repositoryPath: '.hx-update/report.json',
        preparedPath: preparedReportPath,
        expected: reportFingerprint,
        operations,
        installed,
        createdDirectories,
      });
    }
    await operations.checkpoint('after-conflicts', {});
    signal?.throwIfAborted();

    const currentLock = await inspectTransactionPath(target.targetPath, LOCK_FILE_NAME, operations);
    if (target.baseline) {
      if (!currentLock) {
        throw new Error('The template lock disappeared before the update could finish.');
      }
      const parsedCurrentLock = parseTemplateState(
        await readRegularFile(target.targetPath, LOCK_FILE_NAME),
      );
      if (parsedCurrentLock.templateDigest !== target.baseline.templateDigest) {
        throw new Error('The template lock changed before the update could finish.');
      }
      await backupTargetFile({
        target,
        repositoryPath: LOCK_FILE_NAME,
        expected: await fileFingerprint(currentLock.entryPath),
        backupRoot,
        operations,
        backups,
      });
    } else if (currentLock) {
      throw new Error('A template lock appeared before the update could finish.');
    }
    await installPreparedFile({
      target,
      repositoryPath: LOCK_FILE_NAME,
      preparedPath: preparedLockPath,
      expected: lockFingerprint,
      operations,
      installed,
      createdDirectories,
    });
    await operations.checkpoint('after-lock', {});
    signal?.throwIfAborted();

    await pruneDeletedDirectories(target.targetPath, plan.delete, operations);
    committed = true;
    return Object.freeze({
      updated: plan.replace.length,
      added: plan.add.length,
      deleted: plan.delete.length,
      preserved: plan.preserve.length + plan.adopted.length,
      conflicts: plan.conflicts.length,
    });
  } catch (error) {
    const rollbackIssues = await rollbackTransaction({
      transactionPath,
      target,
      operations,
      installed,
      backups,
      createdDirectories,
    });
    if (rollbackIssues.length > 0) {
      throw new AggregateError(
        [error, ...rollbackIssues.map((message) => new Error(message))],
        `The update failed and rollback needs attention. Recovery data remains at ${transactionPath}.`,
      );
    }
    throw error;
  } finally {
    if (committed) {
      await operations.rm(transactionPath, { recursive: true, force: true });
    } else {
      const backupEntries = await readdir(backupRoot).catch(() => ['unknown']);
      if (backupEntries.length === 0) {
        await operations.rm(transactionPath, { recursive: true, force: true });
      }
    }
  }
}
