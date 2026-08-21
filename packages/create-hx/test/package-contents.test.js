import assert from 'node:assert/strict';
import test from 'node:test';
import { checkPackageContents } from '../scripts/check-package-contents.js';

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
  'src/transform.js',
];

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
