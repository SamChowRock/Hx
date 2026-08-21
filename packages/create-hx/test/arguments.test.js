import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { parseArguments, validateProjectName } from '../src/arguments.js';
import { UsageError } from '../src/errors.js';

test('defaults to the current directory and derives its package name', () => {
  const cwd = path.join(path.parse(process.cwd()).root, 'work', 'my-app');

  assert.deepEqual(parseArguments([], { cwd, version: '0.1.0' }), {
    mode: 'scaffold',
    targetPath: cwd,
    projectName: 'my-app',
  });
});

test('resolves an explicit child directory', () => {
  const cwd = path.join(path.parse(process.cwd()).root, 'work');

  assert.deepEqual(parseArguments(['api-service'], { cwd, version: '0.1.0' }), {
    mode: 'scaffold',
    targetPath: path.join(cwd, 'api-service'),
    projectName: 'api-service',
  });
});

test('resolves update mode for the current or one explicit directory', () => {
  const cwd = path.join(path.parse(process.cwd()).root, 'work');

  assert.deepEqual(parseArguments(['--update'], { cwd, version: '0.1.0' }), {
    mode: 'update',
    targetPath: cwd,
  });
  assert.deepEqual(parseArguments(['--update', 'api-service'], { cwd, version: '0.1.0' }), {
    mode: 'update',
    targetPath: path.join(cwd, 'api-service'),
  });
});

test('rejects malformed update invocations', () => {
  const context = { cwd: process.cwd(), version: '0.1.0' };

  assert.throws(() => parseArguments(['--update', '--update'], context), /only once/);
  assert.throws(() => parseArguments(['--update', 'one', 'two'], context), /one directory/);
  assert.throws(() => parseArguments(['--update', '--help'], context), /cannot be combined/);
});

test('returns help and version without deriving a target', () => {
  assert.deepEqual(parseArguments(['--help'], { cwd: process.cwd(), version: '0.1.0' }), {
    mode: 'help',
  });
  assert.deepEqual(parseArguments(['--version'], { cwd: process.cwd(), version: '0.1.0' }), {
    mode: 'version',
    version: '0.1.0',
  });
});

test('rejects unsafe npm names', () => {
  for (const name of ['MyApp', 'my app', '.hidden', '_private', 'node_modules', '应用']) {
    assert.throws(() => validateProjectName(name), UsageError);
  }
});

test('rejects unknown flags and multiple directories', () => {
  assert.throws(
    () => parseArguments(['--force'], { cwd: process.cwd(), version: '0.1.0' }),
    /Unknown option/,
  );
  assert.throws(
    () => parseArguments(['one', 'two'], { cwd: process.cwd(), version: '0.1.0' }),
    /one directory/,
  );
});
