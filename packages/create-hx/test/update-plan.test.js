import assert from 'node:assert/strict';
import test from 'node:test';
import { planTemplateUpdate } from '../src/update-plan.js';

function fingerprint(name, executable = false) {
  return { sha256: name.padEnd(64, name[0]), executable };
}

const BASE = fingerprint('a');
const LOCAL = fingerprint('b');
const INCOMING = fingerprint('c');

function planOne(input = {}) {
  const baseline = Object.hasOwn(input, 'baseline') ? input.baseline : BASE;
  const local = Object.hasOwn(input, 'local') ? input.local : BASE;
  const incoming = Object.hasOwn(input, 'incoming') ? input.incoming : BASE;
  return planTemplateUpdate({
    baselineFiles: baseline === undefined ? {} : { 'file.txt': baseline },
    localFiles: local === undefined ? {} : { 'file.txt': local },
    incomingFiles: incoming === undefined ? {} : { 'file.txt': incoming },
    adopt: input.adopt ?? false,
  });
}

test('encodes the exact tracked-file comparison matrix', () => {
  const cases = [
    {
      name: 'unchanged',
      input: {},
      expected: {},
    },
    {
      name: 'remote-only change',
      input: { incoming: INCOMING },
      expected: { replace: ['file.txt'] },
    },
    {
      name: 'local-only change',
      input: { local: LOCAL },
      expected: { preserve: ['file.txt'] },
    },
    {
      name: 'both changed',
      input: { local: LOCAL, incoming: INCOMING },
      expected: {
        conflicts: [{ path: 'file.txt', reason: 'local-and-incoming-changed' }],
      },
    },
    {
      name: 'local deletion with unchanged incoming',
      input: { local: null },
      expected: { preserve: ['file.txt'] },
    },
    {
      name: 'local deletion with changed incoming',
      input: { local: null, incoming: INCOMING },
      expected: {
        conflicts: [{ path: 'file.txt', reason: 'local-deleted-incoming-changed' }],
      },
    },
    {
      name: 'remote deletion with unchanged local',
      input: { incoming: undefined },
      expected: { delete: ['file.txt'] },
    },
    {
      name: 'remote deletion with changed local',
      input: { local: LOCAL, incoming: undefined },
      expected: { preserve: ['file.txt'] },
    },
    {
      name: 'both deleted',
      input: { local: null, incoming: undefined },
      expected: {},
    },
  ];

  for (const { name, input, expected } of cases) {
    const actual = planOne(input);
    assert.deepEqual(
      actual,
      {
        add: [],
        replace: [],
        delete: [],
        preserve: [],
        conflicts: [],
        adopted: [],
        ...expected,
      },
      name,
    );
  }
});

test('plans incoming additions around existing local files', () => {
  assert.deepEqual(planOne({ baseline: undefined, local: null, incoming: INCOMING }).add, [
    'file.txt',
  ]);
  assert.deepEqual(planOne({ baseline: undefined, local: INCOMING, incoming: INCOMING }).adopted, [
    'file.txt',
  ]);
  assert.deepEqual(planOne({ baseline: undefined, local: LOCAL, incoming: INCOMING }).conflicts, [
    { path: 'file.txt', reason: 'existing-file-differs' },
  ]);
});

test('sorts every output and ignores local-only untracked paths', () => {
  const plan = planTemplateUpdate({
    baselineFiles: {
      'replace-z': BASE,
      'delete-z': BASE,
      'preserve-z': BASE,
      'conflict-z': BASE,
      'replace-a': BASE,
    },
    localFiles: {
      'replace-z': BASE,
      'delete-z': BASE,
      'preserve-z': LOCAL,
      'conflict-z': LOCAL,
      'replace-a': BASE,
      unrelated: LOCAL,
    },
    incomingFiles: {
      'replace-z': INCOMING,
      'preserve-z': BASE,
      'conflict-z': INCOMING,
      'replace-a': INCOMING,
      'add-z': INCOMING,
      'add-a': INCOMING,
    },
  });

  assert.deepEqual(plan.add, ['add-a', 'add-z']);
  assert.deepEqual(plan.replace, ['replace-a', 'replace-z']);
  assert.deepEqual(plan.delete, ['delete-z']);
  assert.deepEqual(plan.preserve, ['preserve-z']);
  assert.deepEqual(plan.conflicts, [{ path: 'conflict-z', reason: 'local-and-incoming-changed' }]);
  assert.equal(JSON.stringify(plan).includes('unrelated'), false);
});

test('supports conservative lockless adoption without a baseline', () => {
  const plan = planTemplateUpdate({
    baselineFiles: {},
    localFiles: {
      'same.txt': INCOMING,
      'different.txt': LOCAL,
      'local-only.txt': LOCAL,
    },
    incomingFiles: {
      'same.txt': INCOMING,
      'different.txt': INCOMING,
      'missing.txt': INCOMING,
    },
    adopt: true,
  });

  assert.deepEqual(plan.add, ['missing.txt']);
  assert.deepEqual(plan.adopted, ['same.txt']);
  assert.deepEqual(plan.conflicts, [{ path: 'different.txt', reason: 'existing-file-differs' }]);
  assert.equal(JSON.stringify(plan).includes('local-only'), false);
  assert.throws(
    () =>
      planTemplateUpdate({
        baselineFiles: { 'old.txt': BASE },
        localFiles: {},
        incomingFiles: {},
        adopt: true,
      }),
    /baseline/,
  );
});

test('returns defensive, recursively frozen plan data', () => {
  const baselineFiles = { 'file.txt': BASE };
  const plan = planTemplateUpdate({
    baselineFiles,
    localFiles: { 'file.txt': LOCAL },
    incomingFiles: { 'file.txt': INCOMING },
  });
  baselineFiles['later.txt'] = BASE;

  assert.deepEqual(plan.conflicts, [{ path: 'file.txt', reason: 'local-and-incoming-changed' }]);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.add), true);
  assert.equal(Object.isFrozen(plan.conflicts), true);
  assert.equal(Object.isFrozen(plan.conflicts[0]), true);
});

test('rejects malformed paths and fingerprints', () => {
  assert.throws(
    () =>
      planTemplateUpdate({
        baselineFiles: { '../escape': BASE },
        localFiles: {},
        incomingFiles: {},
      }),
    /normalized/,
  );
  assert.throws(
    () =>
      planTemplateUpdate({
        baselineFiles: { 'file.txt': { sha256: 'nope', executable: false } },
        localFiles: {},
        incomingFiles: {},
      }),
    /fingerprint/,
  );
});
