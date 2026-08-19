import { UsageError } from './errors.js';

const TOP_LEVEL_FIELDS = new Set([
  'schemaVersion',
  'exclude',
  'required',
  'overrides',
  'stripBlocks',
  'packageJson',
]);
const PACKAGE_JSON_FIELDS = new Set(['removeScriptPrefixes']);
const BLOCK_NAME = /^[a-z0-9-]+$/;

function isPlainObject(value) {
  return (
    value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
  );
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) {
    throw new UsageError(`Manifest ${label} must be a plain object.`);
  }
}

function assertRepositoryPath(value, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\\') ||
    value.startsWith('/') ||
    /^[a-zA-Z]:/.test(value) ||
    value.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new UsageError(`Manifest ${label} must be a normalized repository-relative path.`);
  }
}

function copyUniqueStrings(values, label, validate) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
    throw new UsageError(`Manifest ${label} must be an array of strings.`);
  }

  for (const value of values) {
    validate(value, label);
  }

  if (new Set(values).size !== values.length) {
    throw new UsageError(`Manifest ${label} contains duplicates.`);
  }

  return Object.freeze([...values]);
}

function copyPathArray(values, label) {
  return copyUniqueStrings(values, label, assertRepositoryPath);
}

function copyOverrides(value) {
  assertPlainObject(value, 'overrides');
  const result = {};

  for (const [destination, source] of Object.entries(value)) {
    assertRepositoryPath(destination, 'override destination');
    assertRepositoryPath(source, 'override source');
    result[destination] = source;
  }

  return Object.freeze(result);
}

function assertBlockName(value) {
  if (!BLOCK_NAME.test(value)) {
    throw new UsageError('Manifest block name must use lowercase letters, digits, or hyphens.');
  }
}

function copyStripBlocks(value) {
  assertPlainObject(value, 'stripBlocks');
  const result = {};

  for (const [filePath, names] of Object.entries(value)) {
    assertRepositoryPath(filePath, 'stripBlocks path');
    result[filePath] = copyUniqueStrings(names, 'block names', assertBlockName);
  }

  return Object.freeze(result);
}

function copyPackageJson(value) {
  assertPlainObject(value, 'packageJson');

  for (const field of Object.keys(value)) {
    if (!PACKAGE_JSON_FIELDS.has(field)) {
      throw new UsageError(`Unknown packageJson field: ${field}`);
    }
  }

  const removeScriptPrefixes = copyUniqueStrings(
    value.removeScriptPrefixes,
    'script prefixes',
    (prefix) => {
      if (prefix.length === 0) {
        throw new UsageError('Manifest script prefix must not be empty.');
      }
    },
  );

  return Object.freeze({ removeScriptPrefixes });
}

export function matchesPathPrefix(repositoryPath, prefix) {
  return repositoryPath === prefix || repositoryPath.startsWith(`${prefix}/`);
}

export function isExcludedPath(repositoryPath, manifest) {
  return manifest.exclude.some((prefix) => matchesPathPrefix(repositoryPath, prefix));
}

export function validateManifest(value) {
  assertPlainObject(value, 'root');

  for (const field of Object.keys(value)) {
    if (!TOP_LEVEL_FIELDS.has(field)) {
      throw new UsageError(`Unknown manifest field: ${field}`);
    }
  }

  if (value.schemaVersion !== 1) {
    throw new UsageError(`Unsupported manifest schemaVersion: ${value.schemaVersion}`);
  }

  const exclude = copyPathArray(value.exclude, 'exclude');
  const required = copyPathArray(value.required, 'required');

  for (const requiredPath of required) {
    if (exclude.some((prefix) => matchesPathPrefix(requiredPath, prefix))) {
      throw new UsageError(`Manifest required path is excluded: ${requiredPath}`);
    }
  }

  return Object.freeze({
    schemaVersion: 1,
    exclude,
    required,
    overrides: copyOverrides(value.overrides),
    stripBlocks: copyStripBlocks(value.stripBlocks),
    packageJson: copyPackageJson(value.packageJson),
  });
}
