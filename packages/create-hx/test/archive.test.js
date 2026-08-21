import assert from 'node:assert/strict';
import { access, chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { create as createTar, Header } from 'tar';
import { extractTemplateArchive, inspectTemplateArchive } from '../src/archive.js';

const validManifest = {
  schemaVersion: 1,
  exclude: ['.hx-template', 'docs', 'packages/create-hx'],
  required: ['apps/api/src/main.ts', 'package.json'],
  overrides: { 'README.md': '.hx-template/README.md' },
  stripBlocks: {},
  packageJson: { removeScriptPrefixes: ['tutorial:'] },
};

async function createArchiveFixture(t, files, { executablePaths = [] } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'create-hx-archive-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  for (const [repositoryPath, content] of Object.entries(files)) {
    const filePath = path.join(root, repositoryPath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }
  for (const repositoryPath of executablePaths) {
    await chmod(path.join(root, repositoryPath), 0o755);
  }

  const archivePath = path.join(root, 'fixture.tgz');
  await createTar(
    {
      cwd: root,
      file: archivePath,
      gzip: true,
      portable: true,
    },
    ['Hx-main'],
  );

  const output = path.join(root, 'output');
  return { archivePath, output };
}

function tarBlock({ entryPath, type = 'File', content = '', linkpath = '', mode = 0o644 }) {
  const body = Buffer.from(content);
  const header = new Header({
    path: entryPath,
    type,
    linkpath,
    mode,
    size: type === 'File' || type === 'OldFile' ? body.length : 0,
    mtime: new Date(0),
    uid: 0,
    gid: 0,
  });
  const headerBlock = Buffer.alloc(512);
  header.encode(headerBlock);
  const padding = Buffer.alloc((512 - (body.length % 512)) % 512);
  return Buffer.concat([headerBlock, body, padding]);
}

async function createRawArchive(t, entries) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'create-hx-raw-archive-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const archivePath = path.join(root, 'fixture.tar');
  await writeFile(archivePath, Buffer.concat([...entries.map(tarBlock), Buffer.alloc(1024)]));
  return archivePath;
}

test('reads metadata and extracts only allowed files', async (t) => {
  const fixture = await createArchiveFixture(t, {
    'Hx-main/.hx-template/manifest.json': `${JSON.stringify(validManifest)}\n`,
    'Hx-main/.hx-template/README.md': '# {{PROJECT_NAME}}\n',
    'Hx-main/apps/api/src/main.ts': 'bootstrap();\n',
    'Hx-main/docs/guide.md': 'excluded\n',
    'Hx-main/packages/create-hx/bin/create-hx.js': 'excluded\n',
    'Hx-main/package.json': '{"name":"source"}\n',
    'Hx-main/README.md': 'source\n',
  });

  const metadata = await inspectTemplateArchive(fixture.archivePath);
  assert.equal(metadata.rootName, 'Hx-main');
  assert.equal(metadata.overlays.get('.hx-template/README.md'), '# {{PROJECT_NAME}}\n');

  await extractTemplateArchive({
    archivePath: fixture.archivePath,
    stagingPath: fixture.output,
    rootName: metadata.rootName,
    manifest: metadata.manifest,
  });

  assert.equal(
    await readFile(path.join(fixture.output, 'apps/api/src/main.ts'), 'utf8'),
    'bootstrap();\n',
  );
  await assert.rejects(() => access(path.join(fixture.output, 'docs/guide.md')), {
    code: 'ENOENT',
  });
  await assert.rejects(() => access(path.join(fixture.output, 'packages/create-hx')), {
    code: 'ENOENT',
  });
  await assert.rejects(() => access(path.join(fixture.output, '.hx-template')), {
    code: 'ENOENT',
  });
});

test('preserves executable file permissions', async (t) => {
  const fixture = await createArchiveFixture(
    t,
    {
      'Hx-main/.hx-template/manifest.json': `${JSON.stringify(validManifest)}\n`,
      'Hx-main/.hx-template/README.md': '# {{PROJECT_NAME}}\n',
      'Hx-main/apps/api/src/main.ts': 'bootstrap();\n',
      'Hx-main/package.json': '{"name":"source"}\n',
      'Hx-main/.husky/pre-commit': 'pnpm test\n',
    },
    { executablePaths: ['Hx-main/.husky/pre-commit'] },
  );
  const metadata = await inspectTemplateArchive(fixture.archivePath);

  await extractTemplateArchive({
    archivePath: fixture.archivePath,
    stagingPath: fixture.output,
    rootName: metadata.rootName,
    manifest: metadata.manifest,
  });

  assert.equal((await stat(path.join(fixture.output, '.husky/pre-commit'))).mode & 0o777, 0o755);
});

test('always excludes template metadata and the CLI even when the manifest omits them', async (t) => {
  const fixture = await createArchiveFixture(t, {
    'Hx-main/.hx-template/manifest.json': `${JSON.stringify({
      ...validManifest,
      exclude: ['docs'],
    })}\n`,
    'Hx-main/.hx-template/README.md': '# {{PROJECT_NAME}}\n',
    'Hx-main/apps/api/src/main.ts': 'bootstrap();\n',
    'Hx-main/packages/create-hx/bin/create-hx.js': 'source-only\n',
    'Hx-main/package.json': '{"name":"source"}\n',
  });
  const metadata = await inspectTemplateArchive(fixture.archivePath);

  await extractTemplateArchive({
    archivePath: fixture.archivePath,
    stagingPath: fixture.output,
    rootName: metadata.rootName,
    manifest: metadata.manifest,
  });

  await assert.rejects(() => access(path.join(fixture.output, '.hx-template')), { code: 'ENOENT' });
  await assert.rejects(() => access(path.join(fixture.output, 'packages/create-hx')), {
    code: 'ENOENT',
  });
});

test('rejects traversal, absolute, drive, second-root, link, and duplicate entries', async (t) => {
  const unsafeCases = [
    [{ entryPath: 'Hx-main/', type: 'Directory' }, { entryPath: 'Hx-main/../escape' }, /traversal/],
    [{ entryPath: 'Hx-main/', type: 'Directory' }, { entryPath: '/absolute' }, /absolute/],
    [{ entryPath: 'Hx-main/', type: 'Directory' }, { entryPath: 'C:/drive' }, /drive/],
    [{ entryPath: 'Hx-main/', type: 'Directory' }, { entryPath: 'Other-main/file' }, /common root/],
    [
      { entryPath: 'Hx-main/', type: 'Directory' },
      { entryPath: 'Hx-main/link', type: 'SymbolicLink', linkpath: '../target' },
      /SymbolicLink/,
    ],
    [
      { entryPath: 'Hx-main/', type: 'Directory' },
      { entryPath: 'Hx-main/hard', type: 'Link', linkpath: 'Hx-main/file' },
      /Link/,
    ],
  ];

  for (const [rootEntry, unsafeEntry, expected] of unsafeCases) {
    const archivePath = await createRawArchive(t, [rootEntry, unsafeEntry]);
    await assert.rejects(() => inspectTemplateArchive(archivePath), expected);
  }

  const duplicateArchive = await createRawArchive(t, [
    { entryPath: 'Hx-main/', type: 'Directory' },
    { entryPath: 'Hx-main/package.json', content: '{}' },
    { entryPath: 'Hx-main/package.json', content: '{}' },
  ]);
  await assert.rejects(() => inspectTemplateArchive(duplicateArchive), /Duplicate archive path/);
});

test('rejects corrupt archives and missing or unsupported manifests', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'create-hx-corrupt-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const corruptPath = path.join(root, 'corrupt.tgz');
  await writeFile(corruptPath, 'not a tar archive');
  await assert.rejects(() => inspectTemplateArchive(corruptPath));

  const missing = await createArchiveFixture(t, {
    'Hx-main/package.json': '{}\n',
  });
  await assert.rejects(() => inspectTemplateArchive(missing.archivePath), /manifest.json/);

  const unsupported = await createArchiveFixture(t, {
    'Hx-main/.hx-template/manifest.json': `${JSON.stringify({ ...validManifest, schemaVersion: 2 })}\n`,
  });
  await assert.rejects(() => inspectTemplateArchive(unsupported.archivePath), /schemaVersion/);
});

test('rejects template metadata larger than one MiB', async (t) => {
  const oversized = await createArchiveFixture(t, {
    'Hx-main/.hx-template/manifest.json': 'x'.repeat(1_048_577),
  });

  await assert.rejects(() => inspectTemplateArchive(oversized.archivePath), /1 MiB/);
});
