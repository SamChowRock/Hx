import assert from 'node:assert/strict';
import test from 'node:test';
import { isExcludedPath, matchesPathPrefix, validateManifest } from '../src/manifest.js';

const validManifest = {
  schemaVersion: 1,
  exclude: ['docs', 'packages/create-hx'],
  required: ['package.json'],
  overrides: { 'README.md': '.hx-template/README.md' },
  stripBlocks: { '.github/workflows/ci.yml': ['tutorial'] },
  packageJson: { removeScriptPrefixes: ['tutorial:'] },
};

test('validates and recursively freezes schema version 1', () => {
  const manifest = validateManifest(validManifest);

  assert.equal(Object.isFrozen(manifest), true);
  assert.equal(Object.isFrozen(manifest.exclude), true);
  assert.equal(Object.isFrozen(manifest.required), true);
  assert.equal(Object.isFrozen(manifest.overrides), true);
  assert.equal(Object.isFrozen(manifest.stripBlocks), true);
  assert.equal(Object.isFrozen(manifest.stripBlocks['.github/workflows/ci.yml']), true);
  assert.equal(Object.isFrozen(manifest.packageJson), true);
});

test('copies manifest collections before freezing them', () => {
  const input = structuredClone(validManifest);
  const manifest = validateManifest(input);

  input.exclude.push('later');
  input.stripBlocks['.github/workflows/ci.yml'].push('later');

  assert.deepEqual(manifest.exclude, ['docs', 'packages/create-hx']);
  assert.deepEqual(manifest.stripBlocks['.github/workflows/ci.yml'], ['tutorial']);
});

test('matches exact path-prefix boundaries', () => {
  const manifest = validateManifest(validManifest);

  assert.equal(matchesPathPrefix('docs', 'docs'), true);
  assert.equal(matchesPathPrefix('docs/guide.md', 'docs'), true);
  assert.equal(matchesPathPrefix('docs-old/guide.md', 'docs'), false);
  assert.equal(isExcludedPath('packages/create-hx/src/cli.js', manifest), true);
  assert.equal(isExcludedPath('packages/create-hx-old/src/cli.js', manifest), false);
});

test('rejects unsupported and unknown fields', () => {
  assert.throws(() => validateManifest({ ...validManifest, schemaVersion: 2 }), /schemaVersion/);
  assert.throws(
    () => validateManifest({ ...validManifest, extra: true }),
    /Unknown manifest field/,
  );
});

test('rejects unsafe, duplicate, and contradictory paths', () => {
  assert.throws(
    () => validateManifest({ ...validManifest, exclude: ['../docs'] }),
    /repository-relative/,
  );
  assert.throws(
    () => validateManifest({ ...validManifest, exclude: ['docs', 'docs'] }),
    /duplicates/,
  );
  assert.throws(
    () => validateManifest({ ...validManifest, required: ['docs/guide.md'] }),
    /required path is excluded/,
  );
  assert.throws(
    () =>
      validateManifest({
        ...validManifest,
        overrides: { '../README.md': '.hx-template/README.md' },
      }),
    /repository-relative/,
  );
});

test('rejects malformed blocks, overlays, and script prefixes', () => {
  assert.throws(() => validateManifest({ ...validManifest, overrides: [] }), /overrides/);
  assert.throws(
    () => validateManifest({ ...validManifest, stripBlocks: { '.github/workflows/ci.yml': [''] } }),
    /block name/,
  );
  assert.throws(
    () => validateManifest({ ...validManifest, packageJson: { removeScriptPrefixes: [''] } }),
    /script prefix/,
  );
});
