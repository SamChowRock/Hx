import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  applyTemplateTransforms,
  stripNamedBlocks,
  transformPackageJson,
} from '../src/transform.js';

test('removes one declared source-only block and its markers', () => {
  const input = [
    'before',
    '# hx-template:exclude-start tutorial',
    'remove',
    '# hx-template:exclude-end tutorial',
    'after',
    '',
  ].join('\n');

  assert.equal(stripNamedBlocks(input, ['tutorial']), 'before\nafter\n');
});

test('rejects malformed or missing source-only blocks', () => {
  assert.throws(
    () => stripNamedBlocks('# hx-template:exclude-start tutorial\n', ['tutorial']),
    /Unclosed/,
  );
  assert.throws(
    () =>
      stripNamedBlocks(
        '# hx-template:exclude-start tutorial\n# hx-template:exclude-start other\n',
        ['tutorial'],
      ),
    /Nested/,
  );
  assert.throws(() => stripNamedBlocks('plain\n', ['tutorial']), /Missing template block/);
  assert.throws(
    () => stripNamedBlocks('# hx-template:exclude-end tutorial\n', ['tutorial']),
    /Unmatched/,
  );
});

test('renames package JSON and removes only tutorial scripts', () => {
  const source = JSON.stringify({
    name: 'source',
    private: true,
    scripts: { test: 'jest', 'tutorial:check': 'node check.mjs' },
  });

  const output = transformPackageJson(source, 'my-app', ['tutorial:']);

  assert.deepEqual(JSON.parse(output), {
    name: 'my-app',
    private: true,
    scripts: { test: 'jest' },
  });
  assert.equal(output.endsWith('\n'), true);
});

test('applies README, workflow, and package transformations to staging', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'create-hx-transform-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, '.github/workflows'), { recursive: true });
  await writeFile(path.join(root, 'README.md'), 'source readme\n');
  await writeFile(
    path.join(root, 'package.json'),
    '{"name":"source","scripts":{"test":"node --test","tutorial:check":"node check"}}\n',
  );
  await writeFile(
    path.join(root, '.github/workflows/ci.yml'),
    'before\n# hx-template:exclude-start tutorial\nremove\n# hx-template:exclude-end tutorial\nafter\n',
  );

  await applyTemplateTransforms({
    stagingPath: root,
    projectName: 'my-app',
    manifest: {
      overrides: { 'README.md': '.hx-template/README.md' },
      stripBlocks: { '.github/workflows/ci.yml': ['tutorial'] },
      packageJson: { removeScriptPrefixes: ['tutorial:'] },
    },
    overlays: new Map([['.hx-template/README.md', '# {{PROJECT_NAME}}\n']]),
  });

  assert.equal(await readFile(path.join(root, 'README.md'), 'utf8'), '# my-app\n');
  assert.equal(
    await readFile(path.join(root, '.github/workflows/ci.yml'), 'utf8'),
    'before\nafter\n',
  );
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')), {
    name: 'my-app',
    scripts: { test: 'node --test' },
  });
});

test('requires exactly one project-name token in README overlays', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'create-hx-transform-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'package.json'), '{"name":"source"}\n');

  const manifest = {
    overrides: { 'README.md': '.hx-template/README.md' },
    stripBlocks: {},
    packageJson: { removeScriptPrefixes: [] },
  };

  await assert.rejects(
    () =>
      applyTemplateTransforms({
        stagingPath: root,
        projectName: 'my-app',
        manifest,
        overlays: new Map([['.hx-template/README.md', '# Static\n']]),
      }),
    /exactly one/,
  );
  await assert.rejects(
    () =>
      applyTemplateTransforms({
        stagingPath: root,
        projectName: 'my-app',
        manifest,
        overlays: new Map([['.hx-template/README.md', '# {{PROJECT_NAME}} {{PROJECT_NAME}}\n']]),
      }),
    /exactly one/,
  );
});
