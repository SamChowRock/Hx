import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { create as createTar } from 'tar';
import { createProject, updateProject } from '../src/scaffold.js';
import { LOCK_FILE_NAME, parseTemplateState } from '../src/template-state.js';

const execFileAsync = promisify(execFile);
const testPath = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.join(testPath, 'fixtures');
const repositoryPath = path.resolve(testPath, '../../..');

async function temporaryRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'create-hx-repository-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function createRepositoryArchive(t, { overrides = {}, remove = [] } = {}) {
  const root = await temporaryRoot(t);
  const { stdout } = await execFileAsync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: repositoryPath, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
  );
  const files = stdout.split('\0').filter(Boolean).sort();
  const snapshotPath = path.join(root, 'snapshot');
  for (const repositoryFile of files) {
    const destination = path.join(snapshotPath, repositoryFile);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(repositoryPath, repositoryFile), destination);
  }
  for (const [repositoryFile, contents] of Object.entries(overrides)) {
    const destination = path.join(snapshotPath, repositoryFile);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, contents);
  }
  for (const repositoryFile of remove) {
    await rm(path.join(snapshotPath, repositoryFile), { recursive: true, force: true });
  }
  const archivePath = path.join(root, 'repository.tgz');
  await createTar(
    {
      cwd: snapshotPath,
      file: archivePath,
      gzip: true,
      portable: true,
      prefix: 'Hx-main/',
    },
    ['.'],
  );
  return { archivePath, temporaryDirectory: root };
}

async function serveArchive(t, archivePath) {
  const [key, cert] = await Promise.all([
    readFile(path.join(fixturesPath, 'localhost-key.pem')),
    readFile(path.join(fixturesPath, 'localhost-cert.pem')),
  ]);
  const server = https.createServer({ key, cert }, (_request, response) => {
    createReadStream(archivePath).pipe(response);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, 'localhost', resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return { url: `https://localhost:${server.address().port}/archive`, ca: cert };
}

test('the repository produces the authoritative scaffold and excludes source-only content', async (t) => {
  const fixture = await createRepositoryArchive(t);
  const server = await serveArchive(t, fixture.archivePath);
  const target = path.join(fixture.temporaryDirectory, 'fixture-app');

  await createProject({
    targetPath: target,
    projectName: 'fixture-app',
    sourceUrl: server.url,
    downloadOptions: { ca: server.ca },
    temporaryDirectory: fixture.temporaryDirectory,
  });

  const generatedPackage = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8'));
  assert.equal(generatedPackage.name, 'fixture-app');
  assert.deepEqual(
    Object.keys(generatedPackage.scripts).filter((name) => name.startsWith('tutorial:')),
    [],
  );

  for (const excluded of [
    '.hx-template',
    'BACKEND_SCAFFOLD_BLUEPRINT.md',
    'docs',
    'packages/create-hx',
    'scripts/tutorial',
    'tutorials',
    '.github/workflows/create-hx-ci.yml',
    '.github/workflows/publish-create-hx.yml',
  ]) {
    await assert.rejects(() => access(path.join(target, excluded)), { code: 'ENOENT' });
  }

  for (const required of [
    '.env.example',
    'apps/api/src/main.ts',
    'apps/worker/src/main.ts',
    'docker-compose.yml',
    'package.json',
    'pnpm-lock.yaml',
    'prisma/schema.prisma',
  ]) {
    await access(path.join(target, required));
  }

  const workflow = await readFile(path.join(target, '.github/workflows/ci.yml'), 'utf8');
  assert.doesNotMatch(workflow, /tutorial:|hx-template:exclude/);
  assert.match(workflow, /pnpm test/);

  const readme = await readFile(path.join(target, 'README.md'), 'utf8');
  assert.match(readme, /^# fixture-app$/m);
  assert.doesNotMatch(readme, /tutorial|blueprint|\.hx-template/i);

  const state = parseTemplateState(await readFile(path.join(target, LOCK_FILE_NAME), 'utf8'));
  for (const required of [
    '.gitignore',
    'README.md',
    'apps/api/src/main.ts',
    'apps/worker/src/main.ts',
    'docker-compose.yml',
    'package.json',
    'prisma/schema.prisma',
  ]) {
    assert.equal(Object.hasOwn(state.files, required), true, `${required} is tracked`);
  }
  assert.equal(Object.hasOwn(state.files, LOCK_FILE_NAME), false);
  assert.equal(
    Object.keys(state.files).some((name) => name.startsWith('.hx-template')),
    false,
  );
  assert.equal(
    Object.keys(state.files).some((name) => name.startsWith('.hx-update')),
    false,
  );
  assert.equal(
    Object.keys(state.files).some((name) => name.startsWith('packages/create-hx')),
    false,
  );
  assert.match(await readFile(path.join(target, '.gitignore'), 'utf8'), /^\/\.hx-update\/$/m);
});

test('repository snapshots synchronize without exposing source-only content', async (t) => {
  const versionOneFixture = await createRepositoryArchive(t);
  const versionTwoFixture = await createRepositoryArchive(t, {
    overrides: {
      '.hx-template/README.md': '# {{PROJECT_NAME}}\n\nUpdated repository fixture.\n',
      'apps/api/src/main.ts': 'export const repositoryFixtureVersion = 2;\n',
    },
  });
  const versionOne = await serveArchive(t, versionOneFixture.archivePath);
  const versionTwo = await serveArchive(t, versionTwoFixture.archivePath);
  const target = path.join(versionOneFixture.temporaryDirectory, 'fixture-update-app');

  await createProject({
    targetPath: target,
    projectName: 'fixture-update-app',
    sourceUrl: versionOne.url,
    downloadOptions: { ca: versionOne.ca },
    temporaryDirectory: versionOneFixture.temporaryDirectory,
  });
  await writeFile(path.join(target, 'README.md'), '# local fixture README\n');

  const summary = await updateProject({
    targetPath: target,
    sourceUrl: versionTwo.url,
    downloadOptions: { ca: versionTwo.ca },
    temporaryDirectory: versionOneFixture.temporaryDirectory,
  });

  assert.equal(summary.updated, 1);
  assert.equal(summary.conflicts, 1);
  assert.equal(
    await readFile(path.join(target, 'apps/api/src/main.ts'), 'utf8'),
    'export const repositoryFixtureVersion = 2;\n',
  );
  assert.equal(
    await readFile(path.join(target, '.hx-update/incoming/README.md'), 'utf8'),
    '# fixture-update-app\n\nUpdated repository fixture.\n',
  );

  for (const excluded of [
    '.hx-template',
    'docs',
    'packages/create-hx',
    'scripts/tutorial',
    'tutorials',
  ]) {
    await assert.rejects(() => access(path.join(target, excluded)), { code: 'ENOENT' });
    await assert.rejects(() => access(path.join(target, '.hx-update/incoming', excluded)), {
      code: 'ENOENT',
    });
  }
});
