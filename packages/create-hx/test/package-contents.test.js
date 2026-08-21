import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkPackageContents } from '../scripts/check-package-contents.js';

const packagePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const runtimeFiles = [
  'package.json',
  'README.md',
  'bin/create-hx.js',
  'src/arguments.js',
  'src/archive.js',
  'src/cli.js',
  'src/download.js',
  'src/errors.js',
  'src/manifest.js',
  'src/scaffold.js',
  'src/target.js',
  'src/template-state.js',
  'src/transform.js',
  'src/update-plan.js',
  'src/update-target.js',
];

test('publishes version 0.2.0 with the normalized executable path', async () => {
  const packageJson = JSON.parse(await readFile(path.join(packagePath, 'package.json'), 'utf8'));
  assert.equal(packageJson.version, '0.2.0');
  assert.equal(packageJson.bin['create-hx'], 'bin/create-hx.js');
});

test('accepts required metadata and runtime files only', () => {
  assert.doesNotThrow(() => checkPackageContents(runtimeFiles));
});

test('rejects missing runtime files', () => {
  assert.throws(() => checkPackageContents(runtimeFiles.slice(1)), /Missing package file/);
});

test('rejects tests, locks, templates, repository documents, and unknown runtime files', () => {
  for (const forbidden of [
    'test/archive.test.js',
    'pnpm-lock.yaml',
    '.hx-template/manifest.json',
    'docs/design.md',
    'src/unused.js',
  ]) {
    assert.throws(
      () => checkPackageContents([...runtimeFiles, forbidden]),
      /Unexpected package file/,
    );
  }
});
