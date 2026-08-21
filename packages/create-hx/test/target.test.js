import assert from 'node:assert/strict';
import {
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { commitStaging, inspectTarget } from '../src/target.js';

async function temporaryRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'create-hx-target-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('accepts a missing child and an existing empty directory', async (t) => {
  const root = await temporaryRoot(t);
  const missing = path.join(root, 'missing');
  const empty = path.join(root, 'empty');
  await mkdir(empty);

  assert.deepEqual(await inspectTarget(missing), {
    targetPath: missing,
    targetExisted: false,
    targetIdentity: null,
  });
  const inspectedEmpty = await inspectTarget(empty);
  const emptyStat = await lstat(empty);
  assert.deepEqual(inspectedEmpty, {
    targetPath: empty,
    targetExisted: true,
    targetIdentity: { dev: emptyStat.dev, ino: emptyStat.ino },
  });
});

test('rejects every non-empty target, including hidden entries and .git', async (t) => {
  const root = await temporaryRoot(t);

  for (const name of ['visible', 'hidden', 'git']) {
    const target = path.join(root, name);
    await mkdir(target);
    if (name === 'visible') {
      await writeFile(path.join(target, 'README.md'), 'occupied\n');
    } else if (name === 'hidden') {
      await writeFile(path.join(target, '.keep'), 'occupied\n');
    } else {
      await mkdir(path.join(target, '.git'));
    }

    await assert.rejects(() => inspectTarget(target), /not empty/);
  }
});

test('rejects files, symlinks, dangling symlinks, missing parents, and roots', async (t) => {
  const root = await temporaryRoot(t);
  const file = path.join(root, 'file');
  const directory = path.join(root, 'directory');
  const linkedDirectory = path.join(root, 'linked-directory');
  const dangling = path.join(root, 'dangling');
  await writeFile(file, 'not a directory\n');
  await mkdir(directory);
  await symlink(directory, linkedDirectory);
  await symlink(path.join(root, 'does-not-exist'), dangling);

  for (const target of [file, linkedDirectory, dangling]) {
    await assert.rejects(() => inspectTarget(target), /directory and not a symbolic link/);
  }
  await assert.rejects(
    () => inspectTarget(path.join(root, 'missing-parent', 'child')),
    /parent directory does not exist/,
  );
  await assert.rejects(() => inspectTarget(path.parse(root).root), /filesystem root/);
});

test('commits staging when the target does not exist', async (t) => {
  const root = await temporaryRoot(t);
  const stagingPath = path.join(root, 'staging');
  const targetPath = path.join(root, 'project');
  await mkdir(stagingPath);
  await writeFile(path.join(stagingPath, 'README.md'), 'generated\n');

  await commitStaging({ stagingPath, targetPath, targetExisted: false });

  assert.equal(await readFile(path.join(targetPath, 'README.md'), 'utf8'), 'generated\n');
});

test('does not replace a concurrently created empty target', async (t) => {
  const root = await temporaryRoot(t);
  const stagingPath = path.join(root, 'staging');
  const targetPath = path.join(root, 'project');
  await mkdir(stagingPath);
  await writeFile(path.join(stagingPath, 'README.md'), 'generated\n');
  let injected = false;
  let concurrentIdentity;

  async function createConcurrentTarget() {
    if (!injected) {
      injected = true;
      await mkdir(targetPath);
      const targetStat = await lstat(targetPath);
      concurrentIdentity = { dev: targetStat.dev, ino: targetStat.ino };
    }
  }

  await assert.rejects(
    () =>
      commitStaging({
        stagingPath,
        targetPath,
        targetExisted: false,
        operations: {
          async createDirectory(destination) {
            if (destination === targetPath) {
              await createConcurrentTarget();
            }
            await mkdir(destination);
            const destinationStat = await lstat(destination);
            return { dev: destinationStat.dev, ino: destinationStat.ino };
          },
        },
      }),
    /EEXIST|changed/,
  );

  const finalStat = await lstat(targetPath);
  assert.deepEqual({ dev: finalStat.dev, ino: finalStat.ino }, concurrentIdentity);
  assert.deepEqual(await readdir(targetPath), []);
});

test('copies staging into an existing empty target', async (t) => {
  const root = await temporaryRoot(t);
  const stagingPath = path.join(root, 'staging');
  const targetPath = path.join(root, 'project');
  await mkdir(path.join(stagingPath, 'nested'), { recursive: true });
  await mkdir(targetPath);
  await writeFile(path.join(stagingPath, 'a.txt'), 'a\n');
  await writeFile(path.join(stagingPath, 'nested/b.txt'), 'b\n');
  const target = await inspectTarget(targetPath);

  await commitStaging({ ...target, stagingPath });

  assert.equal(await readFile(path.join(targetPath, 'a.txt'), 'utf8'), 'a\n');
  assert.equal(await readFile(path.join(targetPath, 'nested/b.txt'), 'utf8'), 'b\n');
});

test('rolls back only entries it created and preserves a concurrent file', async (t) => {
  const root = await temporaryRoot(t);
  const stagingPath = path.join(root, 'staging');
  const targetPath = path.join(root, 'project');
  await mkdir(stagingPath);
  await mkdir(targetPath);
  await writeFile(path.join(stagingPath, 'a.txt'), 'a\n');
  await writeFile(path.join(stagingPath, 'b.txt'), 'b\n');
  let copies = 0;
  const target = await inspectTarget(targetPath);

  await assert.rejects(
    () =>
      commitStaging({
        ...target,
        stagingPath,
        operations: {
          async link(source, destination) {
            copies += 1;
            if (copies === 2) {
              await writeFile(path.join(targetPath, 'concurrent.txt'), 'keep me');
              throw new Error('forced copy failure');
            }
            await link(source, destination);
          },
        },
      }),
    /forced copy failure/,
  );

  assert.deepEqual(await readdir(targetPath), ['concurrent.txt']);
  assert.equal(await readFile(path.join(targetPath, 'concurrent.txt'), 'utf8'), 'keep me');
});

test('preserves a concurrent replacement when rolling back a copied file', async (t) => {
  const root = await temporaryRoot(t);
  const stagingPath = path.join(root, 'staging');
  const targetPath = path.join(root, 'project');
  await mkdir(stagingPath);
  await mkdir(targetPath);
  await writeFile(path.join(stagingPath, 'a.txt'), 'generated a\n');
  await writeFile(path.join(stagingPath, 'b.txt'), 'generated b\n');
  const target = await inspectTarget(targetPath);
  let copies = 0;

  await assert.rejects(
    () =>
      commitStaging({
        ...target,
        stagingPath,
        operations: {
          async link(source, destination) {
            copies += 1;
            if (copies === 2) {
              await rm(path.join(targetPath, 'a.txt'));
              await writeFile(path.join(targetPath, 'a.txt'), 'concurrent replacement\n');
              throw new Error('forced copy failure');
            }
            await link(source, destination);
          },
        },
      }),
    /forced copy failure/,
  );

  assert.equal(await readFile(path.join(targetPath, 'a.txt'), 'utf8'), 'concurrent replacement\n');
});

test('preserves a replacement made before the file operation returns', async (t) => {
  const root = await temporaryRoot(t);
  const stagingPath = path.join(root, 'staging');
  const targetPath = path.join(root, 'project');
  await mkdir(stagingPath);
  await mkdir(targetPath);
  await writeFile(path.join(stagingPath, 'a.txt'), 'generated a\n');
  await writeFile(path.join(stagingPath, 'b.txt'), 'generated b\n');
  const target = await inspectTarget(targetPath);
  let operations = 0;

  async function replaceOrFail(writeGenerated) {
    operations += 1;
    if (operations === 2) {
      throw new Error('forced copy failure');
    }
    await writeGenerated();
    await rm(path.join(targetPath, 'a.txt'));
    await writeFile(path.join(targetPath, 'a.txt'), 'replacement before return\n');
  }

  await assert.rejects(
    () =>
      commitStaging({
        ...target,
        stagingPath,
        operations: {
          async copyFile(source, destination, mode) {
            await replaceOrFail(() => copyFile(source, destination, mode));
          },
          async link(source, destination) {
            await replaceOrFail(() => link(source, destination));
          },
        },
      }),
    /forced copy failure/,
  );

  assert.equal(
    await readFile(path.join(targetPath, 'a.txt'), 'utf8'),
    'replacement before return\n',
  );
});

test('detects root replacement at the actual file-write boundary', async (t) => {
  const root = await temporaryRoot(t);
  const stagingPath = path.join(root, 'staging');
  const targetPath = path.join(root, 'project');
  await mkdir(stagingPath);
  await mkdir(targetPath);
  await writeFile(path.join(stagingPath, 'README.md'), 'generated\n');
  const target = await inspectTarget(targetPath);
  let replaced = false;

  async function replaceTarget() {
    if (!replaced) {
      replaced = true;
      await rm(targetPath, { recursive: true });
      await mkdir(targetPath);
    }
  }

  await assert.rejects(
    () =>
      commitStaging({
        ...target,
        stagingPath,
        operations: {
          async copyFile(source, destination, mode) {
            await replaceTarget();
            await copyFile(source, destination, mode);
          },
          async link(source, destination) {
            await replaceTarget();
            await link(source, destination);
          },
        },
      }),
    /changed/,
  );

  assert.deepEqual(await readdir(targetPath), []);
});

test('preserves a replacement created at the rollback deletion boundary', async (t) => {
  const root = await temporaryRoot(t);
  const stagingPath = path.join(root, 'staging');
  const targetPath = path.join(root, 'project');
  const generatedPath = path.join(targetPath, 'a.txt');
  await mkdir(stagingPath);
  await mkdir(targetPath);
  await writeFile(path.join(stagingPath, 'a.txt'), 'generated a\n');
  await writeFile(path.join(stagingPath, 'b.txt'), 'generated b\n');
  const target = await inspectTarget(targetPath);
  let links = 0;
  let rollbackStarted = false;
  let replacementMade = false;

  async function createReplacement() {
    if (!replacementMade) {
      replacementMade = true;
      await rm(generatedPath);
      await writeFile(generatedPath, 'replacement at delete boundary\n');
    }
  }

  await assert.rejects(
    () =>
      commitStaging({
        ...target,
        stagingPath,
        operations: {
          async link(source, destination) {
            links += 1;
            if (links === 2) {
              rollbackStarted = true;
              throw new Error('forced copy failure');
            }
            await link(source, destination);
          },
          async lstat(entryPath) {
            const entryStat = await lstat(entryPath);
            if (rollbackStarted && entryPath === generatedPath) {
              await createReplacement();
            }
            return entryStat;
          },
          async rename(source, destination) {
            await rename(source, destination);
            if (source === generatedPath) {
              await writeFile(generatedPath, 'replacement at delete boundary\n');
              replacementMade = true;
            }
          },
        },
      }),
    /forced copy failure/,
  );

  assert.equal(replacementMade, true);
  assert.equal(await readFile(generatedPath, 'utf8'), 'replacement at delete boundary\n');
});

test('never deletes a replacement inserted into the rollback quarantine', async (t) => {
  const root = await temporaryRoot(t);
  const stagingPath = path.join(root, 'staging');
  const targetPath = path.join(root, 'project');
  await mkdir(stagingPath);
  await mkdir(targetPath);
  await writeFile(path.join(stagingPath, 'a.txt'), 'generated a\n');
  await writeFile(path.join(stagingPath, 'b.txt'), 'generated b\n');
  const target = await inspectTarget(targetPath);
  let links = 0;
  let rollbackStarted = false;
  let replacedRollbackPath = false;

  await assert.rejects(
    () =>
      commitStaging({
        ...target,
        stagingPath,
        operations: {
          async link(source, destination) {
            links += 1;
            if (links === 2) {
              rollbackStarted = true;
              throw new Error('forced copy failure');
            }
            await link(source, destination);
          },
          async lstat(entryPath) {
            const entryStat = await lstat(entryPath);
            if (
              rollbackStarted &&
              (path.basename(entryPath).startsWith('.create-hx-rollback-') ||
                path.basename(path.dirname(entryPath)).startsWith('.create-hx-rollback-')) &&
              !replacedRollbackPath
            ) {
              replacedRollbackPath = true;
              await rm(entryPath);
              await writeFile(entryPath, 'replacement inside rollback\n');
            }
            return entryStat;
          },
        },
      }),
    /forced copy failure/,
  );

  async function containsReplacement(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (await containsReplacement(entryPath)) {
          return true;
        }
      } else if ((await readFile(entryPath, 'utf8')) === 'replacement inside rollback\n') {
        return true;
      }
    }
    return false;
  }

  assert.equal(replacedRollbackPath, true);
  assert.equal(await containsReplacement(root), true);
});

test('rejects an existing target that was deleted and recreated', async (t) => {
  const root = await temporaryRoot(t);
  const stagingPath = path.join(root, 'staging');
  const targetPath = path.join(root, 'project');
  await mkdir(stagingPath);
  await writeFile(path.join(stagingPath, 'README.md'), 'generated\n');
  await mkdir(targetPath);
  const target = await inspectTarget(targetPath);
  await rm(targetPath, { recursive: true });
  await mkdir(targetPath);

  await assert.rejects(() => commitStaging({ ...target, stagingPath }), /changed/);
  assert.deepEqual(await readdir(targetPath), []);
});

test('does not create a target when already aborted', async (t) => {
  const root = await temporaryRoot(t);
  const stagingPath = path.join(root, 'staging');
  const targetPath = path.join(root, 'project');
  await mkdir(stagingPath);
  await writeFile(path.join(stagingPath, 'README.md'), 'generated\n');
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () =>
      commitStaging({
        stagingPath,
        targetPath,
        targetExisted: false,
        targetIdentity: null,
        signal: controller.signal,
      }),
    { name: 'AbortError' },
  );
  await assert.rejects(() => lstat(targetPath), { code: 'ENOENT' });
});
