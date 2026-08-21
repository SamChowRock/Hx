import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  LOCK_FILE_NAME,
  fileFingerprint,
  parseTemplateState,
  scanTemplateState,
  serializeTemplateState,
} from '../src/template-state.js';

const SHA256_EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const SOURCE = { repository: 'SamChowRock/Hx', ref: 'main' };

async function withTemporaryDirectory(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'create-hx-state-test-'));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function makeState(overrides = {}) {
  const files = overrides.files ?? {
    'README.md': { sha256: SHA256_EMPTY, executable: false },
  };
  return {
    schemaVersion: 1,
    source: SOURCE,
    projectName: 'my-app',
    templateDigest: overrides.templateDigest ?? digestFor(files),
    files,
    ...overrides,
  };
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function digestFor(files) {
  return createHash('sha256').update(JSON.stringify(files)).digest('hex');
}

test('scans stable file state, executable bits, and excludes update metadata', async () => {
  await withTemporaryDirectory(async (rootPath) => {
    await mkdir(path.join(rootPath, 'bin'));
    await mkdir(path.join(rootPath, '.hx-update', 'incoming'), { recursive: true });
    await writeFile(path.join(rootPath, 'z.txt'), 'last\n');
    await writeFile(path.join(rootPath, 'bin', 'run.sh'), '#!/bin/sh\n');
    await chmod(path.join(rootPath, 'bin', 'run.sh'), 0o755);
    await writeFile(path.join(rootPath, LOCK_FILE_NAME), 'ignored');
    await writeFile(path.join(rootPath, '.hx-update', 'incoming', 'z.txt'), 'ignored');

    const state = await scanTemplateState(rootPath, { projectName: 'my-app' });

    assert.deepEqual(Object.keys(state.files), ['bin/run.sh', 'z.txt']);
    assert.deepEqual(state.files['bin/run.sh'], {
      sha256: sha256('#!/bin/sh\n'),
      executable: true,
    });
    assert.deepEqual(state.files['z.txt'], {
      sha256: sha256('last\n'),
      executable: false,
    });
    assert.equal(state.templateDigest, sha256(JSON.stringify(state.files)));
    assert.equal(serializeTemplateState(state), `${JSON.stringify(state, null, 2)}\n`);
  });
});

test('produces the same digest independent of creation order', async () => {
  const states = [];
  for (const names of [
    ['z.txt', 'a.txt'],
    ['a.txt', 'z.txt'],
  ]) {
    states.push(
      await withTemporaryDirectory(async (rootPath) => {
        for (const name of names) {
          await writeFile(path.join(rootPath, name), name);
        }
        return scanTemplateState(rootPath, { projectName: 'my-app' });
      }),
    );
  }

  assert.deepEqual(states[0], states[1]);
});

test('tracks repository paths that match JavaScript object special keys', async () => {
  await withTemporaryDirectory(async (rootPath) => {
    await writeFile(path.join(rootPath, '__proto__'), 'prototype file\n');

    const state = await scanTemplateState(rootPath, { projectName: 'my-app' });
    const parsed = parseTemplateState(serializeTemplateState(state));

    assert.equal(Object.hasOwn(state.files, '__proto__'), true);
    assert.deepEqual(parsed.files['__proto__'], {
      sha256: sha256('prototype file\n'),
      executable: false,
    });
  });
});

test('fingerprints regular files and reports a missing file as null', async () => {
  await withTemporaryDirectory(async (rootPath) => {
    const filePath = path.join(rootPath, 'empty');
    await writeFile(filePath, '');
    assert.deepEqual(await fileFingerprint(filePath), {
      sha256: SHA256_EMPTY,
      executable: false,
    });
    assert.equal(await fileFingerprint(path.join(rootPath, 'missing')), null);
  });
});

test('rejects symbolic links and other non-regular entries while scanning', async () => {
  await withTemporaryDirectory(async (rootPath) => {
    await writeFile(path.join(rootPath, 'file'), 'value');
    await symlink('file', path.join(rootPath, 'link'));
    await assert.rejects(() => scanTemplateState(rootPath, { projectName: 'my-app' }), /regular/);
  });
});

test('strictly parses, copies, and recursively freezes template state', () => {
  const input = makeState();
  const parsed = parseTemplateState(JSON.stringify(input));

  assert.deepEqual(parsed, input);
  assert.notEqual(parsed.source, input.source);
  assert.notEqual(parsed.files, input.files);
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.source), true);
  assert.equal(Object.isFrozen(parsed.files), true);
  assert.equal(Object.isFrozen(parsed.files['README.md']), true);
});

test('rejects unsupported schemas and unknown fields at every level', () => {
  assert.throws(
    () => parseTemplateState(JSON.stringify(makeState({ schemaVersion: 2 }))),
    /schemaVersion/,
  );
  assert.throws(
    () => parseTemplateState(JSON.stringify({ ...makeState(), extra: true })),
    /Unknown template state field/,
  );
  assert.throws(
    () => parseTemplateState(JSON.stringify(makeState({ source: { ...SOURCE, extra: true } }))),
    /Unknown source field/,
  );
  const files = { 'README.md': { sha256: SHA256_EMPTY, executable: false, extra: true } };
  assert.throws(
    () => parseTemplateState(JSON.stringify(makeState({ files }))),
    /Unknown file fingerprint field/,
  );
});

test('rejects unsafe, reserved, and unsorted paths', () => {
  for (const invalidPath of [
    '/absolute',
    '../escape',
    'a/../escape',
    'a\\b',
    LOCK_FILE_NAME,
    '.hx-update/incoming/file',
  ]) {
    const files = { [invalidPath]: { sha256: SHA256_EMPTY, executable: false } };
    assert.throws(
      () => parseTemplateState(JSON.stringify(makeState({ files }))),
      /normalized|reserved/,
    );
  }

  const files = {
    'z.txt': { sha256: SHA256_EMPTY, executable: false },
    'a.txt': { sha256: SHA256_EMPTY, executable: false },
  };
  assert.throws(() => parseTemplateState(JSON.stringify(makeState({ files }))), /sorted/);
});

test('rejects malformed fingerprints, source, project names, and digests', () => {
  const malformedHashFiles = {
    'README.md': { sha256: 'ABC', executable: false },
  };
  assert.throws(
    () => parseTemplateState(JSON.stringify(makeState({ files: malformedHashFiles }))),
    /SHA-256/,
  );

  const malformedModeFiles = {
    'README.md': { sha256: SHA256_EMPTY, executable: 0 },
  };
  assert.throws(
    () => parseTemplateState(JSON.stringify(makeState({ files: malformedModeFiles }))),
    /executable/,
  );
  assert.throws(
    () => parseTemplateState(JSON.stringify(makeState({ source: { ...SOURCE, ref: 'dev' } }))),
    /source/,
  );
  assert.throws(
    () => parseTemplateState(JSON.stringify(makeState({ projectName: 'My App' }))),
    /Invalid project name/,
  );
  assert.throws(
    () => parseTemplateState(JSON.stringify(makeState({ projectName: 123 }))),
    /Invalid project name/,
  );
  assert.throws(
    () => parseTemplateState(JSON.stringify(makeState({ templateDigest: SHA256_EMPTY }))),
    /digest/,
  );
});

test('rejects duplicate JSON object keys and file paths', () => {
  const files = { 'a.txt': { sha256: SHA256_EMPTY, executable: false } };
  const state = makeState({ files });
  const duplicatePathJson = `{
    "schemaVersion": 1,
    "source": {"repository": "SamChowRock/Hx", "ref": "main"},
    "projectName": "my-app",
    "templateDigest": "${state.templateDigest}",
    "files": {
      "a.txt": {"sha256": "${SHA256_EMPTY}", "executable": false},
      "a.txt": {"sha256": "${SHA256_EMPTY}", "executable": false}
    }
  }`;
  assert.throws(() => parseTemplateState(duplicatePathJson), /duplicate/i);

  const serialized = serializeTemplateState(state);
  const duplicateTopLevel = serialized.replace(
    '"schemaVersion": 1,',
    '"schemaVersion": 1,\n  "schemaVersion": 1,',
  );
  assert.throws(() => parseTemplateState(duplicateTopLevel), /duplicate/i);
});
