import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { create as createTar } from 'tar';
import { runCli } from '../src/cli.js';
import { createProject, updateProject } from '../src/scaffold.js';
import { LOCK_FILE_NAME, parseTemplateState } from '../src/template-state.js';

const testPath = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.join(testPath, 'fixtures');
const packagePath = path.dirname(testPath);

const baseManifest = {
  schemaVersion: 1,
  exclude: ['.hx-template', 'docs', 'packages/create-hx'],
  required: ['apps/api/src/main.ts', 'package.json'],
  overrides: { 'README.md': '.hx-template/README.md' },
  stripBlocks: { '.github/workflows/ci.yml': ['tutorial'] },
  packageJson: { removeScriptPrefixes: ['tutorial:'] },
};

async function temporaryRoot(t, prefix = 'create-hx-scaffold-') {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function createArchive(t, manifest = baseManifest, fileOverrides = {}) {
  const root = await temporaryRoot(t, 'create-hx-source-');
  const source = path.join(root, 'Hx-main');
  const files = {
    '.hx-template/manifest.json': `${JSON.stringify(manifest)}\n`,
    '.hx-template/README.md': '# {{PROJECT_NAME}}\n\nGenerated from Hx.\n',
    '.github/workflows/ci.yml': [
      'name: CI',
      '# hx-template:exclude-start tutorial',
      '- run: pnpm tutorial:check',
      '# hx-template:exclude-end tutorial',
      '- run: pnpm test',
      '',
    ].join('\n'),
    'apps/api/src/main.ts': 'bootstrap();\n',
    'docs/guide.md': 'source-only\n',
    'package.json': `${JSON.stringify({
      name: 'hx',
      scripts: { test: 'node --test', 'tutorial:check': 'node check.mjs' },
    })}\n`,
    'README.md': 'source readme\n',
    ...fileOverrides,
  };

  for (const [repositoryPath, content] of Object.entries(files)) {
    if (content === null) {
      continue;
    }
    const filePath = path.join(source, repositoryPath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }

  const archivePath = path.join(root, 'source.tgz');
  await createTar({ cwd: root, file: archivePath, gzip: true, portable: true }, ['Hx-main']);
  return archivePath;
}

async function startArchiveServer(t, handler) {
  const [key, cert] = await Promise.all([
    readFile(path.join(fixturesPath, 'localhost-key.pem')),
    readFile(path.join(fixturesPath, 'localhost-cert.pem')),
  ]);
  const server = https.createServer({ key, cert }, handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, 'localhost', resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  return {
    ca: cert,
    url: `https://localhost:${server.address().port}/archive`,
  };
}

async function serveArchive(t, archivePath) {
  return startArchiveServer(t, (_request, response) => {
    createReadStream(archivePath).pipe(response);
  });
}

function captureStream() {
  let output = '';
  return {
    stream: {
      write(chunk) {
        output += chunk;
      },
    },
    read: () => output,
  };
}

test('creates and transforms a project from a local HTTPS archive', async (t) => {
  const root = await temporaryRoot(t);
  const archivePath = await createArchive(t);
  const fixture = await serveArchive(t, archivePath);
  const targetPath = path.join(root, 'my-app');

  await createProject({
    targetPath,
    projectName: 'my-app',
    sourceUrl: fixture.url,
    downloadOptions: { ca: fixture.ca },
    temporaryDirectory: root,
  });

  assert.equal(
    await readFile(path.join(targetPath, 'README.md'), 'utf8'),
    '# my-app\n\nGenerated from Hx.\n',
  );
  assert.deepEqual(JSON.parse(await readFile(path.join(targetPath, 'package.json'), 'utf8')), {
    name: 'my-app',
    scripts: { test: 'node --test' },
  });
  assert.equal(
    await readFile(path.join(targetPath, '.github/workflows/ci.yml'), 'utf8'),
    'name: CI\n- run: pnpm test\n',
  );
  await assert.rejects(() => access(path.join(targetPath, 'docs')), { code: 'ENOENT' });
  await assert.rejects(() => access(path.join(targetPath, '.hx-template')), { code: 'ENOENT' });

  const state = parseTemplateState(await readFile(path.join(targetPath, LOCK_FILE_NAME), 'utf8'));
  assert.equal(state.projectName, 'my-app');
  assert.deepEqual(Object.keys(state.files), [
    '.github/workflows/ci.yml',
    'README.md',
    'apps/api/src/main.ts',
    'package.json',
  ]);
  assert.equal(Object.hasOwn(state.files, LOCK_FILE_NAME), false);
  assert.equal(
    Object.keys(state.files).some((name) => name.startsWith('.hx-update/')),
    false,
  );
});

test('updates a generated project from a second local HTTPS archive', async (t) => {
  const root = await temporaryRoot(t);
  const versionOneArchive = await createArchive(t, baseManifest, {
    'legacy.txt': 'legacy v1\n',
  });
  const versionTwoArchive = await createArchive(t, baseManifest, {
    '.hx-template/README.md': '# {{PROJECT_NAME}}\n\nGenerated from Hx version two.\n',
    'apps/api/src/main.ts': 'bootstrapVersionTwo();\n',
    'new.txt': 'new in v2\n',
  });
  const versionOne = await serveArchive(t, versionOneArchive);
  const versionTwo = await serveArchive(t, versionTwoArchive);
  const targetPath = path.join(root, 'my-app');

  await createProject({
    targetPath,
    projectName: 'my-app',
    sourceUrl: versionOne.url,
    downloadOptions: { ca: versionOne.ca },
    temporaryDirectory: root,
  });
  await writeFile(path.join(targetPath, 'README.md'), '# my locally edited app\n');
  await writeFile(path.join(targetPath, 'user-notes.txt'), 'never touch this\n');

  const summary = await updateProject({
    targetPath,
    sourceUrl: versionTwo.url,
    downloadOptions: { ca: versionTwo.ca },
    temporaryDirectory: root,
  });

  assert.deepEqual(summary, {
    updated: 1,
    added: 1,
    deleted: 1,
    preserved: 0,
    conflicts: 1,
  });
  assert.equal(
    await readFile(path.join(targetPath, 'apps/api/src/main.ts'), 'utf8'),
    'bootstrapVersionTwo();\n',
  );
  assert.equal(await readFile(path.join(targetPath, 'new.txt'), 'utf8'), 'new in v2\n');
  await assert.rejects(() => access(path.join(targetPath, 'legacy.txt')), { code: 'ENOENT' });
  assert.equal(
    await readFile(path.join(targetPath, 'README.md'), 'utf8'),
    '# my locally edited app\n',
  );
  assert.equal(
    await readFile(path.join(targetPath, 'user-notes.txt'), 'utf8'),
    'never touch this\n',
  );
  assert.equal(
    await readFile(path.join(targetPath, '.hx-update/incoming/README.md'), 'utf8'),
    '# my-app\n\nGenerated from Hx version two.\n',
  );
  const state = parseTemplateState(await readFile(path.join(targetPath, LOCK_FILE_NAME), 'utf8'));
  assert.equal(state.files['apps/api/src/main.ts'].sha256.length, 64);
  assert.equal(Object.hasOwn(state.files, 'new.txt'), true);
  assert.equal(Object.hasOwn(state.files, 'legacy.txt'), false);

  let downloadedAgain = false;
  await assert.rejects(
    () =>
      updateProject({
        targetPath,
        temporaryDirectory: root,
        downloadImpl: async () => {
          downloadedAgain = true;
        },
      }),
    /\.hx-update/,
  );
  assert.equal(downloadedAgain, false);
});

test('adopts a lockless create-hx 0.1 project conservatively', async (t) => {
  const root = await temporaryRoot(t);
  const anchors = {
    'apps/worker/src/main.ts': 'worker();\n',
    'docker-compose.yml': 'services: {}\n',
    'prisma/schema.prisma': 'generator client {}\n',
  };
  const versionOneArchive = await createArchive(t, baseManifest, anchors);
  const versionTwoArchive = await createArchive(t, baseManifest, {
    ...anchors,
    '.hx-template/README.md': '# {{PROJECT_NAME}}\n\nVersion two.\n',
    'new.txt': 'new in v2\n',
  });
  const versionOne = await serveArchive(t, versionOneArchive);
  const versionTwo = await serveArchive(t, versionTwoArchive);
  const targetPath = path.join(root, 'legacy-app');

  await createProject({
    targetPath,
    projectName: 'legacy-app',
    sourceUrl: versionOne.url,
    downloadOptions: { ca: versionOne.ca },
    temporaryDirectory: root,
  });
  await rm(path.join(targetPath, LOCK_FILE_NAME));
  await writeFile(path.join(targetPath, 'README.md'), '# legacy local README\n');

  const summary = await updateProject({
    targetPath,
    sourceUrl: versionTwo.url,
    downloadOptions: { ca: versionTwo.ca },
    temporaryDirectory: root,
  });

  assert.equal(summary.updated, 0);
  assert.equal(summary.deleted, 0);
  assert.equal(summary.added, 1);
  assert.equal(summary.conflicts, 1);
  assert.equal(summary.preserved > 0, true);
  assert.equal(
    await readFile(path.join(targetPath, 'README.md'), 'utf8'),
    '# legacy local README\n',
  );
  assert.equal(
    await readFile(path.join(targetPath, '.hx-update/incoming/README.md'), 'utf8'),
    '# legacy-app\n\nVersion two.\n',
  );
  assert.equal(await readFile(path.join(targetPath, 'new.txt'), 'utf8'), 'new in v2\n');
  assert.equal(
    parseTemplateState(await readFile(path.join(targetPath, LOCK_FILE_NAME), 'utf8')).projectName,
    'legacy-app',
  );
});

test('rejects a non-Hx update target before invoking the downloader', async (t) => {
  const root = await temporaryRoot(t);
  const targetPath = path.join(root, 'unrelated');
  await mkdir(targetPath);
  await writeFile(path.join(targetPath, 'package.json'), '{"name":"unrelated"}\n');
  let downloaded = false;

  await assert.rejects(
    () =>
      updateProject({
        targetPath,
        temporaryDirectory: root,
        downloadImpl: async () => {
          downloaded = true;
        },
      }),
    /create-hx 0\.1/,
  );
  assert.equal(downloaded, false);
});

test('verifies required output before writing the target and removes staging', async (t) => {
  const root = await temporaryRoot(t);
  const archivePath = await createArchive(t, {
    ...baseManifest,
    required: [...baseManifest.required, 'missing.txt'],
  });
  const fixture = await serveArchive(t, archivePath);
  const targetPath = path.join(root, 'my-app');

  await assert.rejects(
    () =>
      createProject({
        targetPath,
        projectName: 'my-app',
        sourceUrl: fixture.url,
        downloadOptions: { ca: fixture.ca },
        temporaryDirectory: root,
      }),
    /required.*missing\.txt/i,
  );

  await assert.rejects(() => access(targetPath), { code: 'ENOENT' });
  assert.equal(
    (await readdir(root)).some((name) => name.startsWith('.create-hx-stage-')),
    false,
  );
  assert.equal(
    (await readdir(root)).some((name) => name.startsWith('create-hx-download-')),
    false,
  );
});

test('rechecks an existing target and preserves a concurrent file', async (t) => {
  const root = await temporaryRoot(t);
  const archivePath = await createArchive(t);
  const archive = await readFile(archivePath);
  const targetPath = path.join(root, 'my-app');
  await mkdir(targetPath);
  const fixture = await startArchiveServer(t, async (_request, response) => {
    response.write(archive.subarray(0, Math.ceil(archive.length / 2)));
    await writeFile(path.join(targetPath, 'concurrent.txt'), 'keep me');
    response.end(archive.subarray(Math.ceil(archive.length / 2)));
  });

  await assert.rejects(
    () =>
      createProject({
        targetPath,
        projectName: 'my-app',
        sourceUrl: fixture.url,
        downloadOptions: { ca: fixture.ca },
        temporaryDirectory: root,
      }),
    /not empty/,
  );

  assert.deepEqual(await readdir(targetPath), ['concurrent.txt']);
  assert.equal(await readFile(path.join(targetPath, 'concurrent.txt'), 'utf8'), 'keep me');
});

test('aborts a stalled download and cleans owned temporary directories', async (t) => {
  const root = await temporaryRoot(t);
  const fixture = await startArchiveServer(t, (_request, response) => {
    response.writeHead(200);
    response.write('partial');
  });
  const controller = new AbortController();
  const targetPath = path.join(root, 'my-app');
  setTimeout(() => controller.abort(), 20);

  await assert.rejects(
    () =>
      createProject({
        targetPath,
        projectName: 'my-app',
        sourceUrl: fixture.url,
        signal: controller.signal,
        downloadOptions: { ca: fixture.ca, timeoutMs: 5_000 },
        temporaryDirectory: root,
      }),
    { name: 'AbortError' },
  );

  assert.equal(
    (await readdir(root)).some((name) => name.startsWith('.create-hx-stage-')),
    false,
  );
  assert.equal(
    (await readdir(root)).some((name) => name.startsWith('create-hx-download-')),
    false,
  );
  await assert.rejects(() => access(targetPath), { code: 'ENOENT' });
});

test('cleans staging when download temporary-directory allocation fails', async (t) => {
  const root = await temporaryRoot(t);
  const targetPath = path.join(root, 'my-app');

  await assert.rejects(
    () =>
      createProject({
        targetPath,
        projectName: 'my-app',
        temporaryDirectory: path.join(root, 'missing-temporary-parent'),
      }),
    { code: 'ENOENT' },
  );

  assert.equal(
    (await readdir(root)).some((name) => name.startsWith('.create-hx-stage-')),
    false,
  );
  await assert.rejects(() => access(targetPath), { code: 'ENOENT' });
});

test('does not inspect or commit when aborted immediately after download', async (t) => {
  const root = await temporaryRoot(t);
  const archivePath = await createArchive(t);
  const fixture = await serveArchive(t, archivePath);
  const targetPath = path.join(root, 'my-app');
  const controller = new AbortController();
  let usedInjectedDownload = false;

  await assert.rejects(
    () =>
      createProject({
        targetPath,
        projectName: 'my-app',
        signal: controller.signal,
        sourceUrl: fixture.url,
        downloadOptions: { ca: fixture.ca },
        temporaryDirectory: root,
        downloadImpl: async ({ destination }) => {
          usedInjectedDownload = true;
          await copyFile(archivePath, destination);
          controller.abort();
        },
      }),
    { name: 'AbortError' },
  );

  assert.equal(usedInjectedDownload, true);
  await assert.rejects(() => access(targetPath), { code: 'ENOENT' });
  assert.equal(
    (await readdir(root)).some((name) => name.startsWith('.create-hx-stage-')),
    false,
  );
  assert.equal(
    (await readdir(root)).some((name) => name.startsWith('create-hx-download-')),
    false,
  );
});

test('prints only manual next steps, adding cd only for a child directory', async (t) => {
  const root = await temporaryRoot(t);
  const cwd = path.join(root, 'workspace');
  await mkdir(cwd);

  for (const [argument, expectedCd] of [
    ['.', false],
    ['my-app', true],
  ]) {
    const stdout = captureStream();
    const stderr = captureStream();
    const code = await runCli([argument], {
      cwd,
      stdout: stdout.stream,
      stderr: stderr.stream,
      env: {},
      createProjectImpl: async () => {},
    });

    assert.equal(code, 0);
    assert.equal(stderr.read(), '');
    assert.equal(stdout.read().includes(path.resolve(cwd, argument)), true);
    assert.equal(stdout.read().includes('cd my-app'), expectedCd);
    assert.match(
      stdout.read(),
      /git init\npnpm install\ncp \.env\.example \.env\ndocker compose up --build -d/,
    );
  }
});

test('dispatches update mode and reports conflicts with exit code 2', async (t) => {
  const root = await temporaryRoot(t);
  const targetPath = path.join(root, 'workspace');
  await mkdir(targetPath);
  const stdout = captureStream();
  let received;

  const code = await runCli(['--update'], {
    cwd: targetPath,
    stdout: stdout.stream,
    stderr: captureStream().stream,
    env: {},
    createProjectImpl: async () => assert.fail('create mode must not run'),
    updateProjectImpl: async (options) => {
      received = options;
      return { updated: 1, added: 2, deleted: 3, preserved: 4, conflicts: 1 };
    },
  });

  assert.equal(code, 2);
  assert.equal(received.targetPath, targetPath);
  assert.equal(received.signal instanceof AbortSignal, true);
  assert.match(stdout.read(), /Updated: 1\nAdded: 2\nDeleted: 3\nPreserved: 4\nConflicts: 1/);
  assert.match(stdout.read(), /\.hx-update\/incoming/);
});

test('hides stacks by default and emits them only in debug mode', async (t) => {
  const root = await temporaryRoot(t);
  const cwd = path.join(root, 'workspace');
  await mkdir(cwd);

  for (const [debug, hasStack] of [
    [false, false],
    [true, true],
  ]) {
    const stderr = captureStream();
    const code = await runCli(['my-app'], {
      cwd,
      stdout: captureStream().stream,
      stderr: stderr.stream,
      env: debug ? { CREATE_HX_DEBUG: '1' } : {},
      createProjectImpl: async () => {
        throw new Error('unexpected failure');
      },
    });

    assert.equal(code, 1);
    assert.match(stderr.read(), /unexpected failure/);
    assert.equal(stderr.read().includes('\n    at '), hasStack);
  }
});

test('maps SIGINT and SIGTERM to conventional exit codes after abort cleanup', async (t) => {
  const root = await temporaryRoot(t);
  const cwd = path.join(root, 'workspace');
  await mkdir(cwd);

  for (const [signalName, expectedCode] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ]) {
    const processObject = new EventEmitter();
    let notifyStarted;
    const started = new Promise((resolve) => {
      notifyStarted = resolve;
    });
    const result = runCli(['my-app'], {
      cwd,
      stdout: captureStream().stream,
      stderr: captureStream().stream,
      env: {},
      processObject,
      createProjectImpl: async ({ signal }) => {
        notifyStarted();
        await new Promise((resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              const error = new Error('aborted');
              error.name = 'AbortError';
              reject(error);
            },
            { once: true },
          );
        });
      },
    });

    await started;
    processObject.emit(signalName);
    assert.equal(await result, expectedCode);
    assert.equal(processObject.listenerCount('SIGINT'), 0);
    assert.equal(processObject.listenerCount('SIGTERM'), 0);
  }
});

async function spawnCli(args) {
  const child = spawn(process.execPath, [path.join(packagePath, 'bin/create-hx.js'), ...args], {
    cwd: packagePath,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  return { code, stdout, stderr };
}

test('executable exposes help and version and rejects --force', async () => {
  const help = await spawnCli(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /create-hx \[directory\]/);

  const version = await spawnCli(['--version']);
  assert.equal(version.code, 0);
  assert.equal(version.stdout, '0.2.0\n');

  const force = await spawnCli(['--force']);
  assert.equal(force.code, 1);
  assert.match(force.stderr, /Unknown option: --force/);
  assert.doesNotMatch(force.stderr, /\n {4}at /);
});
