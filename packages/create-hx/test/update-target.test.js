import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  access,
  chmod,
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  collectControlledState,
  commitTemplateUpdate,
  inspectUpdateTarget,
} from '../src/update-target.js';
import {
  LOCK_FILE_NAME,
  parseTemplateState,
  scanTemplateState,
  serializeTemplateState,
} from '../src/template-state.js';
import { planTemplateUpdate } from '../src/update-plan.js';

const ADOPTION_ANCHORS = [
  'package.json',
  'apps/api/src/main.ts',
  'apps/worker/src/main.ts',
  'docker-compose.yml',
  'prisma/schema.prisma',
];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fingerprint(value, executable = false) {
  return { sha256: sha256(value), executable };
}

function stateFor(projectName, files) {
  const sortedFiles = Object.fromEntries(
    Object.entries(files).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  );
  return {
    schemaVersion: 1,
    source: { repository: 'SamChowRock/Hx', ref: 'main' },
    projectName,
    templateDigest: sha256(JSON.stringify(sortedFiles)),
    files: sortedFiles,
  };
}

async function temporaryRoot(t) {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'create-hx-update-target-'));
  t.after(() => rm(rootPath, { recursive: true, force: true }));
  return rootPath;
}

async function writeRepositoryFile(rootPath, repositoryPath, contents = '') {
  const filePath = path.join(rootPath, ...repositoryPath.split('/'));
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
  return filePath;
}

async function createLockedTarget(t, projectName = 'my-app') {
  const rootPath = await temporaryRoot(t);
  await writeRepositoryFile(rootPath, 'package.json', `${JSON.stringify({ name: projectName })}\n`);
  await writeRepositoryFile(rootPath, 'README.md', 'old readme\n');
  const state = await scanTemplateState(rootPath, { projectName });
  await writeFile(path.join(rootPath, LOCK_FILE_NAME), serializeTemplateState(state));
  return { rootPath, state };
}

async function createAdoptionTarget(t, projectName = 'legacy-app') {
  const rootPath = await temporaryRoot(t);
  for (const repositoryPath of ADOPTION_ANCHORS) {
    const contents =
      repositoryPath === 'package.json' ? `${JSON.stringify({ name: projectName })}\n` : 'anchor\n';
    await writeRepositoryFile(rootPath, repositoryPath, contents);
  }
  return rootPath;
}

test('recognizes a locked generated project and keeps the stable template project name', async (t) => {
  const { rootPath, state } = await createLockedTarget(t);
  await writeFile(
    path.join(rootPath, 'package.json'),
    `${JSON.stringify({ name: 'renamed-app' })}\n`,
  );

  const target = await inspectUpdateTarget(rootPath);

  assert.equal(target.targetPath, rootPath);
  assert.equal(target.projectName, 'my-app');
  assert.equal(target.packageName, 'renamed-app');
  assert.deepEqual(target.baseline, state);
  assert.equal(target.adoption, false);
  assert.equal(Number.isInteger(target.rootIdentity.dev), true);
  assert.equal(Number.isInteger(target.rootIdentity.ino), true);
});

test('conservatively recognizes a lockless create-hx 0.1 project', async (t) => {
  const rootPath = await createAdoptionTarget(t);
  const target = await inspectUpdateTarget(rootPath);

  assert.equal(target.projectName, 'legacy-app');
  assert.equal(target.packageName, 'legacy-app');
  assert.equal(target.baseline, null);
  assert.equal(target.adoption, true);
});

test('rejects invalid targets, source trees, and unfinished conflict workspaces', async (t) => {
  const rootPath = await temporaryRoot(t);
  const filePath = await writeRepositoryFile(rootPath, 'file', 'value');
  const linkPath = path.join(rootPath, 'link');
  await symlink(rootPath, linkPath);

  await assert.rejects(() => inspectUpdateTarget(path.parse(rootPath).root), /root/);
  await assert.rejects(() => inspectUpdateTarget(filePath), /directory/);
  await assert.rejects(() => inspectUpdateTarget(linkPath), /symbolic link/);

  const sourceTarget = await createAdoptionTarget(t);
  await mkdir(path.join(sourceTarget, '.hx-template'));
  await assert.rejects(() => inspectUpdateTarget(sourceTarget), /source repository/);

  const conflictTarget = await createAdoptionTarget(t);
  await writeRepositoryFile(conflictTarget, '.hx-update/report.json', '{}');
  await assert.rejects(() => inspectUpdateTarget(conflictTarget), /\.hx-update/);
});

test('rejects invalid locks, package names, and unrelated lockless projects', async (t) => {
  const lockedPath = await temporaryRoot(t);
  await writeRepositoryFile(lockedPath, 'package.json', '{"name":"my-app"}\n');
  await writeRepositoryFile(lockedPath, LOCK_FILE_NAME, '{"schemaVersion":2}\n');
  await assert.rejects(() => inspectUpdateTarget(lockedPath), /schemaVersion|fields/);

  const invalidPackage = await createAdoptionTarget(t, 'legacy-app');
  await writeRepositoryFile(invalidPackage, 'package.json', '{"name":"Invalid Name"}\n');
  await assert.rejects(() => inspectUpdateTarget(invalidPackage), /Invalid project name/);

  const unrelated = await temporaryRoot(t);
  await writeRepositoryFile(unrelated, 'package.json', '{"name":"my-app"}\n');
  await assert.rejects(() => inspectUpdateTarget(unrelated), /create-hx 0\.1/);
});

test('collects only the baseline and incoming path union', async (t) => {
  const { rootPath, state: baseline } = await createLockedTarget(t);
  await writeRepositoryFile(rootPath, 'incoming.txt', 'new local collision\n');
  await symlink('missing-target', path.join(rootPath, 'untracked-link'));
  const incoming = stateFor('my-app', {
    'README.md': fingerprint('new readme\n'),
    'incoming.txt': fingerprint('incoming template\n'),
    'missing.txt': fingerprint('missing\n'),
  });
  const target = await inspectUpdateTarget(rootPath);

  const localFiles = await collectControlledState(target, incoming);

  assert.deepEqual(Object.keys(localFiles), [
    'incoming.txt',
    'missing.txt',
    'package.json',
    'README.md',
  ]);
  assert.deepEqual(localFiles['README.md'], fingerprint('old readme\n'));
  assert.deepEqual(localFiles['incoming.txt'], fingerprint('new local collision\n'));
  assert.equal(localFiles['missing.txt'], null);
  assert.deepEqual(
    localFiles['package.json'],
    fingerprint(await readFile(path.join(rootPath, 'package.json'))),
  );
  assert.equal(Object.hasOwn(localFiles, 'untracked-link'), false);
  assert.deepEqual(target.baseline, baseline);
});

test('rejects controlled symlinks, directories, and symlinked ancestors', async (t) => {
  const { rootPath } = await createLockedTarget(t);
  const outside = await temporaryRoot(t);
  await writeRepositoryFile(outside, 'file.txt', 'outside\n');

  await symlink(path.join(outside, 'file.txt'), path.join(rootPath, 'linked-file'));
  const linkedFileState = stateFor('my-app', {
    'linked-file': fingerprint('incoming\n'),
  });
  let target = await inspectUpdateTarget(rootPath);
  await assert.rejects(() => collectControlledState(target, linkedFileState), /regular file/);

  await mkdir(path.join(rootPath, 'directory'));
  const directoryState = stateFor('my-app', { directory: fingerprint('incoming\n') });
  target = await inspectUpdateTarget(rootPath);
  await assert.rejects(() => collectControlledState(target, directoryState), /regular file/);

  await symlink(outside, path.join(rootPath, 'linked-directory'));
  const ancestorState = stateFor('my-app', {
    'linked-directory/file.txt': fingerprint('incoming\n'),
  });
  target = await inspectUpdateTarget(rootPath);
  await assert.rejects(() => collectControlledState(target, ancestorState), /ancestor/);
});

test('rejects an unwritable project directory', async (t) => {
  const rootPath = await createAdoptionTarget(t);
  await chmod(rootPath, 0o555);
  try {
    await assert.rejects(() => inspectUpdateTarget(rootPath), /writable|permission/i);
  } finally {
    await chmod(rootPath, 0o755);
  }
});

async function createTransactionFixture(t) {
  const targetPath = await temporaryRoot(t);
  const templatePath = await temporaryRoot(t);
  const baselineContents = {
    'package.json': '{"name":"my-app"}\n',
    'replace.txt': 'replace base\n',
    'remove/deep/only.txt': 'remove base\n',
    'preserve.txt': 'preserve base\n',
    'conflict.txt': 'conflict base\n',
    'bin/tool.sh': '#!/bin/sh\n',
  };
  for (const [repositoryPath, contents] of Object.entries(baselineContents)) {
    await writeRepositoryFile(targetPath, repositoryPath, contents);
  }
  await chmod(path.join(targetPath, 'bin/tool.sh'), 0o644);
  const baseline = await scanTemplateState(targetPath, { projectName: 'my-app' });
  await writeFile(path.join(targetPath, LOCK_FILE_NAME), serializeTemplateState(baseline));

  await writeFile(path.join(targetPath, 'preserve.txt'), 'preserve local\n');
  await writeFile(path.join(targetPath, 'conflict.txt'), 'conflict local\n');

  const incomingContents = {
    'package.json': baselineContents['package.json'],
    'replace.txt': 'replace incoming\n',
    'preserve.txt': baselineContents['preserve.txt'],
    'conflict.txt': 'conflict incoming\n',
    'bin/tool.sh': baselineContents['bin/tool.sh'],
    'added/deep/new.txt': 'added incoming\n',
  };
  for (const [repositoryPath, contents] of Object.entries(incomingContents)) {
    await writeRepositoryFile(templatePath, repositoryPath, contents);
  }
  await chmod(path.join(templatePath, 'bin/tool.sh'), 0o755);
  const incoming = await scanTemplateState(templatePath, { projectName: 'my-app' });
  await writeFile(path.join(templatePath, LOCK_FILE_NAME), serializeTemplateState(incoming));

  const target = await inspectUpdateTarget(targetPath);
  const localFiles = await collectControlledState(target, incoming);
  const plan = planTemplateUpdate({
    baselineFiles: baseline.files,
    localFiles,
    incomingFiles: incoming.files,
  });
  return { targetPath, templatePath, baseline, incoming, target, plan };
}

async function assertOriginalTransactionProject(fixture) {
  assert.equal(
    await readFile(path.join(fixture.targetPath, 'replace.txt'), 'utf8'),
    'replace base\n',
  );
  assert.equal(
    await readFile(path.join(fixture.targetPath, 'remove/deep/only.txt'), 'utf8'),
    'remove base\n',
  );
  assert.equal(
    await readFile(path.join(fixture.targetPath, 'preserve.txt'), 'utf8'),
    'preserve local\n',
  );
  assert.equal(
    await readFile(path.join(fixture.targetPath, 'conflict.txt'), 'utf8'),
    'conflict local\n',
  );
  await assert.rejects(() => access(path.join(fixture.targetPath, 'added/deep/new.txt')), {
    code: 'ENOENT',
  });
  await assert.rejects(() => access(path.join(fixture.targetPath, '.hx-update')), {
    code: 'ENOENT',
  });
  assert.deepEqual(
    JSON.parse(await readFile(path.join(fixture.targetPath, LOCK_FILE_NAME), 'utf8')),
    fixture.baseline,
  );
}

test('transaction applies safe changes, writes conflicts, prunes directories, and installs lock last', async (t) => {
  const fixture = await createTransactionFixture(t);
  const checkpoints = [];

  const summary = await commitTemplateUpdate({
    target: fixture.target,
    templatePath: fixture.templatePath,
    incomingState: fixture.incoming,
    plan: fixture.plan,
    operations: {
      checkpoint(name) {
        checkpoints.push(name);
      },
    },
  });

  assert.deepEqual(summary, {
    updated: 2,
    added: 1,
    deleted: 1,
    preserved: 1,
    conflicts: 1,
    report: true,
  });
  assert.equal(
    await readFile(path.join(fixture.targetPath, 'replace.txt'), 'utf8'),
    'replace incoming\n',
  );
  assert.equal(
    await readFile(path.join(fixture.targetPath, 'added/deep/new.txt'), 'utf8'),
    'added incoming\n',
  );
  await assert.rejects(() => access(path.join(fixture.targetPath, 'remove')), { code: 'ENOENT' });
  assert.equal(
    await readFile(path.join(fixture.targetPath, 'preserve.txt'), 'utf8'),
    'preserve local\n',
  );
  assert.equal(
    await readFile(path.join(fixture.targetPath, 'conflict.txt'), 'utf8'),
    'conflict local\n',
  );
  assert.equal(
    await readFile(path.join(fixture.targetPath, '.hx-update/incoming/conflict.txt'), 'utf8'),
    'conflict incoming\n',
  );
  const report = JSON.parse(
    await readFile(path.join(fixture.targetPath, '.hx-update/report.json'), 'utf8'),
  );
  assert.deepEqual(report.conflicts, fixture.plan.conflicts);
  assert.equal(report.templateDigest, fixture.incoming.templateDigest);
  assert.notEqual((await stat(path.join(fixture.targetPath, 'bin/tool.sh'))).mode & 0o111, 0);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(fixture.targetPath, LOCK_FILE_NAME), 'utf8')),
    fixture.incoming,
  );
  assert.equal(checkpoints.at(-1), 'after-lock');
});

test('transaction rolls back after every operation class', async (t) => {
  for (const checkpointName of [
    'after-add',
    'after-replace',
    'after-delete',
    'after-conflicts',
    'after-lock',
  ]) {
    await t.test(checkpointName, async (subtest) => {
      const fixture = await createTransactionFixture(subtest);
      await assert.rejects(
        () =>
          commitTemplateUpdate({
            target: fixture.target,
            templatePath: fixture.templatePath,
            incomingState: fixture.incoming,
            plan: fixture.plan,
            operations: {
              checkpoint(name) {
                if (name === checkpointName) {
                  throw new Error(`injected ${name}`);
                }
              },
            },
          }),
        new RegExp(`injected ${checkpointName}`),
      );
      await assertOriginalTransactionProject(fixture);
    });
  }
});

test('transaction detects a replacement race and preserves the raced file', async (t) => {
  const fixture = await createTransactionFixture(t);
  let raced = false;

  await assert.rejects(
    () =>
      commitTemplateUpdate({
        target: fixture.target,
        templatePath: fixture.templatePath,
        incomingState: fixture.incoming,
        plan: fixture.plan,
        operations: {
          async checkpoint(name, context) {
            if (name === 'before-backup' && context.path === 'replace.txt' && !raced) {
              raced = true;
              await writeFile(path.join(fixture.targetPath, 'replace.txt'), 'raced local\n');
            }
          },
        },
      }),
    /changed/,
  );

  assert.equal(raced, true);
  assert.equal(
    await readFile(path.join(fixture.targetPath, 'replace.txt'), 'utf8'),
    'raced local\n',
  );
});

test('transaction preserves a concurrent rollback replacement and the original backup', async (t) => {
  const fixture = await createTransactionFixture(t);
  let replacedDuringRollback = false;

  await assert.rejects(() =>
    commitTemplateUpdate({
      target: fixture.target,
      templatePath: fixture.templatePath,
      incomingState: fixture.incoming,
      plan: fixture.plan,
      operations: {
        async checkpoint(name, context) {
          if (name === 'after-replace') {
            throw new Error('start rollback');
          }
          if (
            name === 'before-rollback-installed' &&
            context.path === 'replace.txt' &&
            !replacedDuringRollback
          ) {
            replacedDuringRollback = true;
            await writeFile(path.join(fixture.targetPath, 'replace.txt'), 'rollback concurrent\n');
          }
        },
      },
    }),
  );

  assert.equal(replacedDuringRollback, true);
  assert.equal(
    await readFile(path.join(fixture.targetPath, 'replace.txt'), 'utf8'),
    'rollback concurrent\n',
  );
  const preserved = (await readdir(fixture.targetPath)).filter((name) =>
    name.startsWith('.create-hx-preserved-'),
  );
  assert.equal(preserved.length, 1);
  assert.equal(
    await readFile(path.join(fixture.targetPath, preserved[0]), 'utf8'),
    'replace base\n',
  );
});

test('transaction aborts between operation classes and rolls back', async (t) => {
  const fixture = await createTransactionFixture(t);
  const controller = new AbortController();

  await assert.rejects(
    () =>
      commitTemplateUpdate({
        target: fixture.target,
        templatePath: fixture.templatePath,
        incomingState: fixture.incoming,
        plan: fixture.plan,
        signal: controller.signal,
        operations: {
          checkpoint(name) {
            if (name === 'after-add') {
              controller.abort();
            }
          },
        },
      }),
    { name: 'AbortError' },
  );
  await assertOriginalTransactionProject(fixture);
});

test('transaction removes its sibling workspace after a complete rollback', async (t) => {
  const fixture = await createTransactionFixture(t);
  let transactionPath;

  await assert.rejects(() =>
    commitTemplateUpdate({
      target: fixture.target,
      templatePath: fixture.templatePath,
      incomingState: fixture.incoming,
      plan: fixture.plan,
      operations: {
        async mkdtemp(prefix) {
          transactionPath = await mkdtemp(prefix);
          return transactionPath;
        },
        checkpoint(name) {
          if (name === 'after-replace') {
            throw new Error('rollback cleanup');
          }
        },
      },
    }),
  );

  await assert.rejects(() => access(transactionPath), { code: 'ENOENT' });
});

test('transaction rollback preserves a concurrently created parent directory', async (t) => {
  const fixture = await createTransactionFixture(t);
  const concurrentDirectory = path.join(fixture.targetPath, 'added');
  let raced = false;

  await assert.rejects(() =>
    commitTemplateUpdate({
      target: fixture.target,
      templatePath: fixture.templatePath,
      incomingState: fixture.incoming,
      plan: fixture.plan,
      operations: {
        async mkdir(directoryPath, options) {
          if (directoryPath === concurrentDirectory && !raced) {
            raced = true;
            await mkdir(directoryPath);
            const error = new Error('created concurrently');
            error.code = 'EEXIST';
            throw error;
          }
          return mkdir(directoryPath, options);
        },
        checkpoint(name) {
          if (name === 'after-add') {
            throw new Error('rollback concurrent directory');
          }
        },
      },
    }),
  );

  assert.equal(raced, true);
  assert.deepEqual(await readdir(concurrentDirectory), []);
});

test('transaction rejects any concurrent lock change even when its file digest is unchanged', async (t) => {
  const fixture = await createTransactionFixture(t);
  const changedLock = { ...fixture.baseline, projectName: 'other-app' };
  let changed = false;

  await assert.rejects(
    () =>
      commitTemplateUpdate({
        target: fixture.target,
        templatePath: fixture.templatePath,
        incomingState: fixture.incoming,
        plan: fixture.plan,
        operations: {
          async checkpoint(name) {
            if (name === 'after-conflicts' && !changed) {
              changed = true;
              await writeFile(
                path.join(fixture.targetPath, LOCK_FILE_NAME),
                serializeTemplateState(changedLock),
              );
            }
          },
        },
      }),
    /lock changed/,
  );

  assert.equal(changed, true);
  assert.equal(
    parseTemplateState(await readFile(path.join(fixture.targetPath, LOCK_FILE_NAME), 'utf8'))
      .projectName,
    'other-app',
  );
  assert.equal(
    await readFile(path.join(fixture.targetPath, 'replace.txt'), 'utf8'),
    'replace base\n',
  );
  await assert.rejects(() => access(path.join(fixture.targetPath, 'added/deep/new.txt')), {
    code: 'ENOENT',
  });
});

test('transaction rejects a byte-identical lock inode replacement after planning', async (t) => {
  const fixture = await createTransactionFixture(t);
  const lockPath = path.join(fixture.targetPath, LOCK_FILE_NAME);
  const lockText = await readFile(lockPath, 'utf8');
  await rename(lockPath, path.join(fixture.targetPath, 'original-template-lock.json'));
  await writeFile(lockPath, lockText);

  await assert.rejects(
    () =>
      commitTemplateUpdate({
        target: fixture.target,
        templatePath: fixture.templatePath,
        incomingState: fixture.incoming,
        plan: fixture.plan,
      }),
    /lock changed/,
  );

  assert.equal(await readFile(lockPath, 'utf8'), lockText);
  await assert.rejects(() => access(path.join(fixture.targetPath, 'added/deep/new.txt')), {
    code: 'ENOENT',
  });
});

test('transaction journals an installed file before post-link verification can fail', async (t) => {
  const fixture = await createTransactionFixture(t);
  const addedPath = path.join(fixture.targetPath, 'added/deep/new.txt');
  let failedAfterLink = false;

  await assert.rejects(
    () =>
      commitTemplateUpdate({
        target: fixture.target,
        templatePath: fixture.templatePath,
        incomingState: fixture.incoming,
        plan: fixture.plan,
        operations: {
          async link(sourcePath, targetPath) {
            await link(sourcePath, targetPath);
            if (targetPath === addedPath && !failedAfterLink) {
              failedAfterLink = true;
              throw new Error('post-link verification failure');
            }
          },
        },
      }),
    /post-link verification failure/,
  );

  assert.equal(failedAfterLink, true);
  await assertOriginalTransactionProject(fixture);
});

test('transaction journals a backup before post-rename verification can fail', async (t) => {
  const fixture = await createTransactionFixture(t);
  const replacedPath = path.join(fixture.targetPath, 'replace.txt');
  let failedAfterRename = false;

  await assert.rejects(
    () =>
      commitTemplateUpdate({
        target: fixture.target,
        templatePath: fixture.templatePath,
        incomingState: fixture.incoming,
        plan: fixture.plan,
        operations: {
          async rename(sourcePath, targetPath) {
            await rename(sourcePath, targetPath);
            if (sourcePath === replacedPath && !failedAfterRename) {
              failedAfterRename = true;
              throw new Error('post-rename verification failure');
            }
          },
        },
      }),
    /post-rename verification failure/,
  );

  assert.equal(failedAfterRename, true);
  await assertOriginalTransactionProject(fixture);
});

test('transaction rejects same-content replacements of planned files and ancestors', async (t) => {
  await t.test('ancestor directory identity', async (subtest) => {
    const fixture = await createTransactionFixture(subtest);
    const binPath = path.join(fixture.targetPath, 'bin');
    const originalBinPath = path.join(fixture.targetPath, 'original-bin');
    await rename(binPath, originalBinPath);
    await mkdir(binPath);
    await copyFile(path.join(originalBinPath, 'tool.sh'), path.join(binPath, 'tool.sh'));
    await chmod(path.join(binPath, 'tool.sh'), 0o644);

    await assert.rejects(
      () =>
        commitTemplateUpdate({
          target: fixture.target,
          templatePath: fixture.templatePath,
          incomingState: fixture.incoming,
          plan: fixture.plan,
        }),
      /changed.*plan|planned.*changed/i,
    );

    assert.equal(await readFile(path.join(binPath, 'tool.sh'), 'utf8'), '#!/bin/sh\n');
    await assert.rejects(() => access(path.join(fixture.targetPath, 'added/deep/new.txt')), {
      code: 'ENOENT',
    });
  });

  await t.test('file identity', async (subtest) => {
    const fixture = await createTransactionFixture(subtest);
    const replacePath = path.join(fixture.targetPath, 'replace.txt');
    const originalPath = path.join(fixture.targetPath, 'original-replace.txt');
    await rename(replacePath, originalPath);
    await writeFile(replacePath, 'replace base\n');

    await assert.rejects(
      () =>
        commitTemplateUpdate({
          target: fixture.target,
          templatePath: fixture.templatePath,
          incomingState: fixture.incoming,
          plan: fixture.plan,
        }),
      /changed.*plan|planned.*changed/i,
    );

    assert.equal(await readFile(replacePath, 'utf8'), 'replace base\n');
    await assert.rejects(() => access(path.join(fixture.targetPath, 'added/deep/new.txt')), {
      code: 'ENOENT',
    });
  });
});

test('transaction rejects an ancestor symlink swap before rename without touching its target', async (t) => {
  const fixture = await createTransactionFixture(t);
  const outside = await temporaryRoot(t);
  await writeRepositoryFile(outside, 'tool.sh', '#!/bin/sh\noutside\n');
  let swapped = false;

  await assert.rejects(
    () =>
      commitTemplateUpdate({
        target: fixture.target,
        templatePath: fixture.templatePath,
        incomingState: fixture.incoming,
        plan: fixture.plan,
        operations: {
          async checkpoint(name, context) {
            if (name === 'before-backup' && context.path === 'bin/tool.sh' && !swapped) {
              swapped = true;
              await rename(
                path.join(fixture.targetPath, 'bin'),
                path.join(fixture.targetPath, 'original-bin'),
              );
              await symlink(outside, path.join(fixture.targetPath, 'bin'));
            }
          },
        },
      }),
    /changed.*plan|planned.*changed/i,
  );

  assert.equal(swapped, true);
  assert.equal(await readFile(path.join(outside, 'tool.sh'), 'utf8'), '#!/bin/sh\noutside\n');
  assert.equal(
    await readFile(path.join(fixture.targetPath, 'original-bin/tool.sh'), 'utf8'),
    '#!/bin/sh\n',
  );
  await assert.rejects(() => access(path.join(fixture.targetPath, 'added/deep/new.txt')), {
    code: 'ENOENT',
  });
});

test('transaction reports a locally modified file removed from the incoming template', async (t) => {
  const targetPath = await temporaryRoot(t);
  const templatePath = await temporaryRoot(t);
  await writeRepositoryFile(targetPath, 'package.json', '{"name":"my-app"}\n');
  await writeRepositoryFile(targetPath, 'orphan.txt', 'template base\n');
  const baseline = await scanTemplateState(targetPath, { projectName: 'my-app' });
  await writeFile(path.join(targetPath, LOCK_FILE_NAME), serializeTemplateState(baseline));
  await writeFile(path.join(targetPath, 'orphan.txt'), 'local orphan\n');

  await writeRepositoryFile(templatePath, 'package.json', '{"name":"my-app"}\n');
  const incoming = await scanTemplateState(templatePath, { projectName: 'my-app' });
  await writeFile(path.join(templatePath, LOCK_FILE_NAME), serializeTemplateState(incoming));
  const target = await inspectUpdateTarget(targetPath);
  const localFiles = await collectControlledState(target, incoming);
  const plan = planTemplateUpdate({
    baselineFiles: baseline.files,
    localFiles,
    incomingFiles: incoming.files,
  });

  const summary = await commitTemplateUpdate({
    target,
    templatePath,
    incomingState: incoming,
    plan,
  });

  assert.deepEqual(summary, {
    updated: 0,
    added: 0,
    deleted: 0,
    preserved: 1,
    conflicts: 0,
    report: true,
  });
  assert.equal(await readFile(path.join(targetPath, 'orphan.txt'), 'utf8'), 'local orphan\n');
  const report = JSON.parse(
    await readFile(path.join(targetPath, '.hx-update/report.json'), 'utf8'),
  );
  assert.deepEqual(report.preserved, [
    { path: 'orphan.txt', reason: 'incoming-deleted-local-changed' },
  ]);
  assert.deepEqual(report.conflicts, []);
  await assert.rejects(() => access(path.join(targetPath, '.hx-update/incoming/orphan.txt')), {
    code: 'ENOENT',
  });
});
