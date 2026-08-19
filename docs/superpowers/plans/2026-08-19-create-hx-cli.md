# `create-hx` CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and independently publish `create-hx`, a safe CLI that downloads the latest Hx `main` archive and creates a documentation-free scaffold in a new or empty directory.

**Architecture:** Keep `packages/create-hx/` outside the root pnpm workspace with its own lockfile and buildless ESM modules. Download one GitHub tarball, validate a versioned manifest and every archive entry, stage filtered output, apply deterministic transforms, then atomically rename or rollback-safe copy the completed scaffold into the target.

**Tech Stack:** Node.js 24.19.0 ESM, Node built-in test runner, `tar` 7.5.22, pnpm 11.21.0, GitHub Actions, npm Trusted Publishing/OIDC.

**Spec:** `docs/superpowers/specs/2026-08-19-create-hx-cli-design.md`

## Global Constraints

- The npm package name is exactly `create-hx`, initially versioned `0.1.0`.
- Supported runtime is Node.js `>=24.19.0 <25`; package-local commands use pnpm `>=11.21.0 <12` with `--ignore-workspace`.
- Production downloads exactly `https://codeload.github.com/SamChowRock/Hx/tar.gz/refs/heads/main`.
- Public syntax is limited to `[directory]`, `--help`, and `--version`; directory defaults to `.`.
- Targets must be missing or completely empty; there is no force mode and no existing entry may be overwritten.
- The CLI never installs dependencies, initializes Git, starts Docker, runs migrations, or runs application tests.
- Output excludes `.hx-template/`, `docs/`, `tutorials/`, `scripts/tutorial/`, `BACKEND_SCAFFOLD_BLUEPRINT.md`, `packages/create-hx/`, and CLI-only workflows.
- Downloads are limited to 100 MiB compressed data, a 30-second inactivity timeout, and five HTTPS redirects.
- Extraction accepts ordinary files and directories only, ignores only the structural common-root entry, and rejects traversal, links, devices, FIFOs, duplicates, and multiple roots.
- Expected errors write `Error: <message>` without a stack and exit `1`; unexpected stacks require `CREATE_HX_DEBUG=1`.
- Every production behavior is implemented after its focused test has failed for the intended reason.
- In this workspace, `node` and `pnpm` commands mean the bundled Node 24.19.0 and bundled pnpm 11.21.0 paths returned by `load_workspace_dependencies`, not the host Node 22 binary.

---

### Task 1: Independent Package and Argument Contract

**Files:**

- Create: `packages/create-hx/package.json`
- Create: `packages/create-hx/pnpm-lock.yaml`
- Create: `packages/create-hx/README.md`
- Create: `packages/create-hx/src/errors.js`
- Create: `packages/create-hx/src/arguments.js`
- Create: `packages/create-hx/test/arguments.test.js`

**Interfaces:**

- Produces: `UsageError extends Error`.
- Produces: `validateProjectName(name)` returning the valid name or throwing `UsageError`.
- Produces: `parseArguments(argv, { cwd, version })` returning help, version, or `{ mode: 'scaffold', targetPath, projectName }`.

- [ ] **Step 1: Add package configuration and a failing argument test**

Create `packages/create-hx/package.json`:

```json
{
  "name": "create-hx",
  "version": "0.1.0",
  "description": "Create a production-oriented Hx NestJS project",
  "type": "module",
  "bin": { "create-hx": "./bin/create-hx.js" },
  "files": ["bin", "src", "README.md"],
  "scripts": {
    "test": "node --test",
    "test:coverage": "node --test --experimental-test-coverage",
    "pack:check": "node ./scripts/check-package-contents.js"
  },
  "engines": { "node": ">=24.19.0 <25", "pnpm": ">=11.21.0 <12" },
  "publishConfig": { "access": "public", "registry": "https://registry.npmjs.org/" },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/SamChowRock/Hx.git",
    "directory": "packages/create-hx"
  },
  "private": false,
  "dependencies": { "tar": "^7.5.22" },
  "packageManager": "pnpm@11.21.0"
}
```

Create `test/arguments.test.js`:

```js
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

test('returns help and version without deriving a target', () => {
  assert.deepEqual(parseArguments(['--help'], { cwd: process.cwd(), version: '0.1.0' }), {
    mode: 'help',
  });
  assert.deepEqual(parseArguments(['--version'], { cwd: process.cwd(), version: '0.1.0' }), {
    mode: 'version',
    version: '0.1.0',
  });
});

test('rejects unsafe npm names, unknown flags, and multiple directories', () => {
  for (const name of ['MyApp', 'my app', '.hidden', '_private', 'node_modules', '应用']) {
    assert.throws(() => validateProjectName(name), UsageError);
  }
  assert.throws(
    () => parseArguments(['--force'], { cwd: process.cwd(), version: '0.1.0' }),
    /Unknown option/,
  );
  assert.throws(
    () => parseArguments(['one', 'two'], { cwd: process.cwd(), version: '0.1.0' }),
    /one directory/,
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

```bash
/Users/shenzhou/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm --dir packages/create-hx --ignore-workspace exec node --test test/arguments.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/arguments.js`.

- [ ] **Step 3: Implement errors and argument parsing**

Create `src/errors.js`:

```js
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}
```

Create `src/arguments.js`:

```js
import path from 'node:path';
import { UsageError } from './errors.js';

const SAFE_UNSCOPED_NAME = /^[a-z0-9][a-z0-9._-]*$/;
const RESERVED_NAMES = new Set(['node_modules', 'favicon.ico']);

export function validateProjectName(name) {
  if (
    name.length === 0 ||
    name.length > 214 ||
    !SAFE_UNSCOPED_NAME.test(name) ||
    RESERVED_NAMES.has(name)
  ) {
    throw new UsageError(
      `Invalid project name "${name}". Use a lowercase directory name such as "my-app".`,
    );
  }
  return name;
}

export function parseArguments(argv, { cwd, version }) {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) return { mode: 'help' };
  if (argv.length === 1 && (argv[0] === '--version' || argv[0] === '-v'))
    return { mode: 'version', version };
  const unknown = argv.find((argument) => argument.startsWith('-'));
  if (unknown) throw new UsageError(`Unknown option: ${unknown}`);
  if (argv.length > 1) throw new UsageError('Expected at most one directory argument.');
  const targetPath = path.resolve(cwd, argv[0] ?? '.');
  return {
    mode: 'scaffold',
    targetPath,
    projectName: validateProjectName(path.basename(targetPath)),
  };
}
```

Create a package README documenting the three approved invocations, Node requirement, empty-directory rule, and manual follow-up behavior.

- [ ] **Step 4: Install the independent dependency set**

```bash
/Users/shenzhou/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm --dir packages/create-hx install --ignore-workspace
```

Expected: package-local `pnpm-lock.yaml` contains `tar@7.5.22`; root `pnpm-lock.yaml` is unchanged.

- [ ] **Step 5: Verify GREEN and commit**

```bash
pnpm --dir packages/create-hx --ignore-workspace exec node --test test/arguments.test.js
pnpm exec prettier --check packages/create-hx
git diff --check
git add packages/create-hx
git commit -m "feat(create-hx): add independent CLI package"
```

Expected: tests and checks PASS before the commit.

### Task 2: Versioned Manifest Validation

**Files:**

- Create: `packages/create-hx/src/manifest.js`
- Create: `packages/create-hx/test/manifest.test.js`

**Interfaces:**

- Consumes: `UsageError`.
- Produces: `validateManifest(value)`, `matchesPathPrefix(repositoryPath, prefix)`, and `isExcludedPath(repositoryPath, manifest)`.

- [ ] **Step 1: Write failing manifest tests**

```js
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
});

test('matches exact path-prefix boundaries', () => {
  assert.equal(matchesPathPrefix('docs', 'docs'), true);
  assert.equal(matchesPathPrefix('docs/guide.md', 'docs'), true);
  assert.equal(matchesPathPrefix('docs-old/guide.md', 'docs'), false);
  assert.equal(
    isExcludedPath('packages/create-hx/src/cli.js', validateManifest(validManifest)),
    true,
  );
});

test('rejects unsupported, unknown, unsafe, duplicate, and contradictory values', () => {
  assert.throws(() => validateManifest({ ...validManifest, schemaVersion: 2 }), /schemaVersion/);
  assert.throws(
    () => validateManifest({ ...validManifest, extra: true }),
    /Unknown manifest field/,
  );
  assert.throws(
    () => validateManifest({ ...validManifest, exclude: ['../docs'] }),
    /repository-relative/,
  );
  assert.throws(
    () => validateManifest({ ...validManifest, exclude: ['docs', 'docs'] }),
    /duplicate/,
  );
  assert.throws(
    () => validateManifest({ ...validManifest, required: ['docs/guide.md'] }),
    /required path is excluded/,
  );
});
```

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --dir packages/create-hx --ignore-workspace exec node --test test/manifest.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/manifest.js`.

- [ ] **Step 3: Implement strict schema validation**

Use an exact top-level field set and normalized POSIX repository paths:

```js
const TOP_LEVEL_FIELDS = new Set([
  'schemaVersion',
  'exclude',
  'required',
  'overrides',
  'stripBlocks',
  'packageJson',
]);

export function matchesPathPrefix(repositoryPath, prefix) {
  return repositoryPath === prefix || repositoryPath.startsWith(`${prefix}/`);
}

function assertRepositoryPath(value, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\\') ||
    value.startsWith('/') ||
    value.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new UsageError(`${label} must be a normalized repository-relative path.`);
  }
}
```

`validateManifest` must reject non-plain objects, unknown fields, schema versions other than `1`, non-string arrays, empty strings, duplicates, excluded required paths, invalid override paths, duplicate/invalid block names, and duplicate/empty script prefixes. Copy and freeze all nested arrays/objects before returning the six known fields.

- [ ] **Step 4: Verify GREEN and commit**

```bash
pnpm --dir packages/create-hx --ignore-workspace exec node --test test/manifest.test.js
pnpm --dir packages/create-hx --ignore-workspace test
git add packages/create-hx/src/manifest.js packages/create-hx/test/manifest.test.js
git commit -m "feat(create-hx): validate template manifests"
```

### Task 3: Deterministic Project Transforms

**Files:**

- Create: `packages/create-hx/src/transform.js`
- Create: `packages/create-hx/test/transform.test.js`

**Interfaces:**

- Consumes: a validated manifest and overlay map.
- Produces: `stripNamedBlocks(source, names)`, `transformPackageJson(source, projectName, prefixes)`, and `applyTemplateTransforms(options)`.

- [ ] **Step 1: Write failing transform tests**

Test literal block and JSON behavior:

```js
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

test('rejects unmatched, nested, duplicate, unknown, and missing markers', () => {
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
```

Add one real temporary-directory test that writes README, package JSON, and workflow files, calls `applyTemplateTransforms`, and asserts README equals `# my-app\n`, workflow equals `before\nafter\n`, and package scripts contain only `test`.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --dir packages/create-hx --ignore-workspace exec node --test test/transform.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/transform.js`.

- [ ] **Step 3: Implement exact block and JSON transforms**

Use exact line regexes:

```js
const START = /^# hx-template:exclude-start ([a-z0-9-]+)$/;
const END = /^# hx-template:exclude-end ([a-z0-9-]+)$/;
```

`stripNamedBlocks` must process newline-preserving lines, allow no nesting, require every declared block exactly once, reject undeclared/end-without-start markers, and remove the markers plus enclosed lines. `transformPackageJson` parses JSON, sets `name`, filters only matching script prefixes, and returns two-space JSON plus one trailing newline.

`applyTemplateTransforms` must keep all destinations beneath staging, require each overlay source in the map, require exactly one `{{PROJECT_NAME}}` token in the README overlay, write overrides, strip declared workflow blocks, then structurally rewrite root `package.json`.

- [ ] **Step 4: Verify GREEN and commit**

```bash
pnpm --dir packages/create-hx --ignore-workspace exec node --test test/transform.test.js
pnpm --dir packages/create-hx --ignore-workspace test
git add packages/create-hx/src/transform.js packages/create-hx/test/transform.test.js
git commit -m "feat(create-hx): transform scaffold metadata"
```

### Task 4: Bounded HTTPS Downloader

**Files:**

- Create: `packages/create-hx/src/download.js`
- Create: `packages/create-hx/test/download.test.js`
- Create: `packages/create-hx/test/fixtures/localhost-key.pem`
- Create: `packages/create-hx/test/fixtures/localhost-cert.pem`

**Interfaces:**

- Produces: `DEFAULT_DOWNLOAD_LIMITS`.
- Produces: `downloadToFile({ url, destination, signal, timeoutMs, maxBytes, maxRedirects, ca })` resolving `{ bytes, finalUrl }`.

- [ ] **Step 1: Generate a test-only localhost certificate**

```bash
mkdir -p packages/create-hx/test/fixtures
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 3650 -subj '/CN=localhost' -addext 'subjectAltName=DNS:localhost' -keyout packages/create-hx/test/fixtures/localhost-key.pem -out packages/create-hx/test/fixtures/localhost-cert.pem
```

The private key is only a loopback test fixture and is excluded by the npm `files` list.

- [ ] **Step 2: Write failing real-HTTPS tests**

Use `https.createServer` with `/archive`, `/redirect`, `/missing`, `/large`, and `/stall`. The core success test is:

```js
test('downloads bytes and follows a bounded HTTPS redirect', async (t) => {
  const fixture = await startHttpsFixtureServer();
  t.after(fixture.close);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'create-hx-download-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const destination = path.join(directory, 'archive.tgz');
  const result = await downloadToFile({
    url: `${fixture.origin}/redirect`,
    destination,
    ca: fixture.ca,
    timeoutMs: 1_000,
    maxBytes: 64,
    maxRedirects: 2,
  });
  assert.equal(await readFile(destination, 'utf8'), 'archive-bytes');
  assert.deepEqual(result, { bytes: 13, finalUrl: `${fixture.origin}/archive` });
});
```

Add separate assertions that HTTP URLs, 404 responses, a five-byte response with `maxBytes: 4`, a 25 ms stalled response, a redirect with `maxRedirects: 0`, and an aborted request all reject. Every failure must leave no destination file.

- [ ] **Step 3: Run and verify RED**

```bash
pnpm --dir packages/create-hx --ignore-workspace exec node --test test/download.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/download.js`.

- [ ] **Step 4: Implement streaming HTTPS limits and cleanup**

Export exact production defaults:

```js
export const DEFAULT_DOWNLOAD_LIMITS = Object.freeze({
  timeoutMs: 30_000,
  maxBytes: 100 * 1024 * 1024,
  maxRedirects: 5,
});
```

Implement with `node:https`, `pipeline`, and a counting `Transform`. Validate HTTPS on the initial and every redirected URL, resolve relative `Location`, reject missing/invalid locations, count redirects, reject terminal non-2xx status, destroy on size overflow, use `request.setTimeout`, pass `signal` and `ca`, and open the destination with exclusive `wx`. On every failure, close handles and unlink only the destination passed by the caller.

- [ ] **Step 5: Verify GREEN and commit**

```bash
pnpm --dir packages/create-hx --ignore-workspace exec node --test test/download.test.js
pnpm --dir packages/create-hx --ignore-workspace test
git add packages/create-hx/src/download.js packages/create-hx/test/download.test.js packages/create-hx/test/fixtures
git commit -m "feat(create-hx): download bounded HTTPS archives"
```

### Task 5: Safe Two-pass Archive Processing

**Files:**

- Create: `packages/create-hx/src/archive.js`
- Create: `packages/create-hx/test/archive.test.js`

**Interfaces:**

- Consumes: `validateManifest` and `isExcludedPath`.
- Produces: `inspectTemplateArchive(archivePath)` resolving `{ rootName, manifest, overlays }`.
- Produces: `extractTemplateArchive({ archivePath, stagingPath, rootName, manifest })`.

- [ ] **Step 1: Write failing tests using real tarballs**

Use `tar.create` to create a gzip archive from a temporary tree:

```js
test('reads metadata and extracts only allowed files', async (t) => {
  const fixture = await createArchiveFixture(t, {
    'Hx-main/.hx-template/manifest.json': JSON.stringify(validManifest),
    'Hx-main/.hx-template/README.md': '# {{PROJECT_NAME}}\n',
    'Hx-main/apps/api/src/main.ts': 'bootstrap();\n',
    'Hx-main/docs/guide.md': 'excluded\n',
    'Hx-main/packages/create-hx/bin/create-hx.js': 'excluded\n',
    'Hx-main/package.json': '{"name":"source"}\n',
  });
  const metadata = await inspectTemplateArchive(fixture.archivePath);
  assert.equal(metadata.rootName, 'Hx-main');
  assert.equal(metadata.overlays.get('.hx-template/README.md'), '# {{PROJECT_NAME}}\n');
  await extractTemplateArchive({
    archivePath: fixture.archivePath,
    stagingPath: fixture.output,
    ...metadata,
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
});
```

Create malicious headers with `tar.Pack` and add focused tests for `../` traversal, absolute and drive paths, a second root, duplicate paths, symbolic links, hard links, corrupt gzip, missing manifest, unknown schema, metadata over 1 MiB, and preservation of file mode `0o755`.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --dir packages/create-hx --ignore-workspace exec node --test test/archive.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/archive.js`.

- [ ] **Step 3: Implement entry classification and metadata inspection**

Create a private entry validator that rejects NUL/backslash/absolute/drive paths, rejects original `.` or `..` segments, establishes one non-empty root, ignores only its structural directory entry, accepts only `File`, `OldFile`, and `Directory`, and rejects duplicates after stripping the root.

Implement `inspectTemplateArchive` using `tar.list({ file, strict: true, onentry })`. Drain every entry; buffer only regular files under `.hx-template/`; reject a metadata file after `1_048_576` bytes; parse and validate `.hx-template/manifest.json`; then require every declared overlay source in the buffered map.

- [ ] **Step 4: Implement the second extraction pass**

Use `tar.extract` with `strip: 1`, `preserveOwner: false`, and `strict: true`. Its filter must re-run the entry validator and return false for `isExcludedPath(repositoryPath, manifest)`. After extraction, recursively `lstat` staging and reject every non-file/non-directory node. Never call `realpath` on archive-controlled paths before link rejection.

- [ ] **Step 5: Verify GREEN and commit**

```bash
pnpm --dir packages/create-hx --ignore-workspace exec node --test test/archive.test.js
pnpm --dir packages/create-hx --ignore-workspace test
git add packages/create-hx/src/archive.js packages/create-hx/test/archive.test.js
git commit -m "feat(create-hx): safely extract Hx archives"
```

### Task 6: Target Commit, Orchestration, and Executable

**Files:**

- Create: `packages/create-hx/src/target.js`
- Create: `packages/create-hx/src/scaffold.js`
- Create: `packages/create-hx/src/cli.js`
- Create: `packages/create-hx/bin/create-hx.js`
- Create: `packages/create-hx/test/target.test.js`
- Create: `packages/create-hx/test/scaffold.test.js`

**Interfaces:**

- Consumes: all Task 1–5 interfaces.
- Produces: `inspectTarget(targetPath)`, `commitStaging(options)`, `createProject(options)`, and `runCli(argv, dependencies)`.

- [ ] **Step 1: Write failing target and rollback tests**

Using real temporary directories, test missing child, existing empty directory, hidden file, `.git/`, ordinary file, symlink, dangling symlink, non-directory target, missing parent, and root target. Inject a `copyFile` that fails after the first copied file and assert rollback preserves a concurrent file:

```js
await assert.rejects(
  () =>
    commitStaging({ stagingPath, targetPath, targetExisted: true, operations: failingOperations }),
  /forced copy failure/,
);
assert.deepEqual(await readdir(targetPath), ['concurrent.txt']);
assert.equal(await readFile(path.join(targetPath, 'concurrent.txt'), 'utf8'), 'keep me');
```

- [ ] **Step 2: Run target tests and verify RED**

```bash
pnpm --dir packages/create-hx --ignore-workspace exec node --test test/target.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/target.js`.

- [ ] **Step 3: Implement target inspection and safe commit**

`inspectTarget` uses `lstat`, rejects roots using `path.parse(targetPath).root === targetPath`, requires an existing writable parent directory, and requires an existing target directory to have zero entries.

`commitStaging` rechecks target eligibility. New targets use `rename`. Existing targets enumerate staging lexically, create directories individually, copy files with `COPYFILE_EXCL`, and record each created path. On failure, reverse the record and call only `unlink(file)` or non-recursive `rmdir(directory)`; never recursively remove the user target.

- [ ] **Step 4: Write failing orchestration and process tests**

With a local HTTPS archive server, test successful `createProject`, missing required output before target write, target becoming non-empty before commit, aborted-download cleanup, success instructions for `.` and a child directory, expected error formatting, and debug-only stacks.

Spawn `bin/create-hx.js --help`, `--version`, and `--force` using Node 24.19.0. Assert exit codes and user-visible output, not private calls.

- [ ] **Step 5: Run orchestration tests and verify RED**

```bash
pnpm --dir packages/create-hx --ignore-workspace exec node --test test/scaffold.test.js
```

Expected: FAIL because scaffold, CLI, and executable modules do not exist.

- [ ] **Step 6: Implement the complete lifecycle**

Export the fixed URL:

```js
export const HX_MAIN_ARCHIVE_URL =
  'https://codeload.github.com/SamChowRock/Hx/tar.gz/refs/heads/main';
```

`createProject` must inspect target, create sibling staging and an OS-temporary download directory, download, inspect, extract, transform, verify every required path and absence of exclusions, recheck target, commit, then remove staging/download paths in `finally`.

`runCli` reads version from package metadata, calls `parseArguments`, installs one `AbortController` for `SIGINT`/`SIGTERM`, prints help/version or calls `createProject`, prints only approved manual commands, formats expected errors without stacks, and includes unexpected stacks only when `CREATE_HX_DEBUG=1`. Signal exits use `130` for `SIGINT` and `143` for `SIGTERM` after cleanup.

`bin/create-hx.js` has a Node shebang, invokes `runCli(process.argv.slice(2), ...)`, sets `process.exitCode`, and has mode `0o755`.

- [ ] **Step 7: Verify GREEN and commit**

```bash
pnpm --dir packages/create-hx --ignore-workspace exec node --test test/target.test.js test/scaffold.test.js
pnpm --dir packages/create-hx --ignore-workspace test
git add packages/create-hx/bin packages/create-hx/src packages/create-hx/test
git commit -m "feat(create-hx): create projects safely"
```

### Task 7: Live Template Metadata and Repository Fixture

**Files:**

- Create: `.hx-template/manifest.json`
- Create: `.hx-template/README.md`
- Modify: `.github/workflows/ci.yml`
- Create: `packages/create-hx/test/repository-fixture.test.js`

**Interfaces:**

- Consumes: `createProject` and all archive/transform behavior.
- Produces: the authoritative schema-version-1 manifest and concise README overlay.

- [ ] **Step 1: Write the failing repository fixture test**

Build a gzip tarball from `git ls-files -z` plus the uncommitted manifest/README paths, prefix entries with `Hx-main/`, serve it from the local HTTPS fixture, and call `createProject`. Assert real output:

```js
assert.equal(
  JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8')).name,
  'fixture-app',
);
for (const excluded of [
  '.hx-template',
  'BACKEND_SCAFFOLD_BLUEPRINT.md',
  'docs',
  'packages/create-hx',
  'scripts/tutorial',
  'tutorials',
  '.github/workflows/create-hx-ci.yml',
  '.github/workflows/publish-create-hx.yml',
]) {
  await assert.rejects(() => access(path.join(target, excluded)), { code: 'ENOENT' });
}
for (const required of [
  '.env.example',
  'apps/api/src/main.ts',
  'apps/worker/src/main.ts',
  'docker-compose.yml',
  'package.json',
  'pnpm-lock.yaml',
  'prisma/schema.prisma',
]) {
  await access(path.join(target, required));
}
const generatedPackage = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8'));
assert.deepEqual(
  Object.keys(generatedPackage.scripts).filter((name) => name.startsWith('tutorial:')),
  [],
);
const workflow = await readFile(path.join(target, '.github/workflows/ci.yml'), 'utf8');
assert.doesNotMatch(workflow, /tutorial:|hx-template:exclude/);
```

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --dir packages/create-hx --ignore-workspace exec node --test test/repository-fixture.test.js
```

Expected: FAIL because `.hx-template/manifest.json` is missing.

- [ ] **Step 3: Add the manifest and concise README**

Create `.hx-template/manifest.json` with the exact schema object in the design, including both CLI workflow exclusions and all required paths.

Create `.hx-template/README.md` with exactly one token:

````markdown
# {{PROJECT_NAME}}

A production-oriented NestJS modular-monolith with separate API and Worker processes.

## Prerequisites

- Node.js 24.19.0
- pnpm 11.21.0
- Docker Desktop or Docker CLI with Compose

## Start locally

```bash
git init
pnpm install
cp .env.example .env
docker compose up --build -d
```

Open `http://localhost:3000/docs` for OpenAPI and `http://localhost:8025` for Mailpit.

## Verify

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose config --quiet
```
````

- [ ] **Step 4: Mark source-only tutorial CI steps**

Wrap only the existing tutorial steps in `.github/workflows/ci.yml`:

```yaml
# hx-template:exclude-start tutorial
- run: pnpm tutorial:check
- name: Check whether code changes received tutorial review
  env:
    TUTORIAL_BASE_REF: ${{ github.event.pull_request.base.sha || github.event.before }}
  run: pnpm tutorial:impact:check
# hx-template:exclude-end tutorial
```

Formatting, linting, type checking, application tests, Docker checks, and cleanup remain outside the marked block.

- [ ] **Step 5: Verify GREEN and commit**

```bash
pnpm --dir packages/create-hx --ignore-workspace exec node --test test/repository-fixture.test.js
pnpm --dir packages/create-hx --ignore-workspace test
pnpm exec prettier --check .hx-template .github/workflows/ci.yml packages/create-hx
git add .hx-template .github/workflows/ci.yml packages/create-hx/test/repository-fixture.test.js
git commit -m "feat(create-hx): define Hx template contents"
```

### Task 8: Package Guard, CI, and Trusted Publishing

**Files:**

- Create: `packages/create-hx/scripts/check-package-contents.js`
- Create: `packages/create-hx/test/package-contents.test.js`
- Create: `.github/workflows/create-hx-ci.yml`
- Create: `.github/workflows/publish-create-hx.yml`
- Modify: `.github/dependabot.yml`

**Interfaces:**

- Produces: `checkPackageContents(files)` and executable `pnpm pack:check`.
- Produces: source-only CLI CI and tag-triggered npm publishing.

- [ ] **Step 1: Write the failing package-content test**

```js
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

test('rejects tests, locks, templates, and repository documents', () => {
  for (const forbidden of [
    'test/archive.test.js',
    'pnpm-lock.yaml',
    '.hx-template/manifest.json',
    'docs/design.md',
  ]) {
    assert.throws(
      () => checkPackageContents([...runtimeFiles, forbidden]),
      /Unexpected package file/,
    );
  }
});
```

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --dir packages/create-hx --ignore-workspace exec node --test test/package-contents.test.js
```

Expected: FAIL because `scripts/check-package-contents.js` is missing.

- [ ] **Step 3: Implement and run the real npm-pack guard**

Export `checkPackageContents(files)`. It must require every runtime file listed above, allow only `package.json`, `README.md`, `bin/`, and `src/`, and throw for missing or additional files. When invoked as a script, run `npm pack --dry-run --json`, read `result[0].files[].path`, and call the exported checker.

```bash
pnpm --dir packages/create-hx --ignore-workspace exec node --test test/package-contents.test.js
pnpm --dir packages/create-hx --ignore-workspace pack:check
```

Expected: the test and the real dry-run PASS; tests, fixtures, scripts, and locks are absent from the package.

- [ ] **Step 4: Add source-only CLI CI**

Create `.github/workflows/create-hx-ci.yml` with pull-request and `main` push filters for `packages/create-hx/**`, `.hx-template/**`, `.github/workflows/ci.yml`, and itself. Set `contents: read`, then use `actions/checkout@v6`, `pnpm/action-setup@v4` at `11.21.0`, and `actions/setup-node@v6` at `24.19.0`. Run:

```yaml
- run: pnpm install --ignore-workspace --frozen-lockfile
  working-directory: packages/create-hx
- run: pnpm test
  working-directory: packages/create-hx
- run: pnpm pack:check
  working-directory: packages/create-hx
```

- [ ] **Step 5: Add tag-validated Trusted Publishing**

Create `.github/workflows/publish-create-hx.yml` triggered by `create-hx-v*`, with `contents: read` and `id-token: write`. Use a GitHub-hosted Ubuntu runner, `actions/setup-node@v6` at Node 24.19.0, npm registry URL, and disabled package-manager cache.

Validate tag and npm floor before install:

```bash
PACKAGE_VERSION="$(node -p "require('./packages/create-hx/package.json').version")"
test "${GITHUB_REF_NAME}" = "create-hx-v${PACKAGE_VERSION}"
NPM_VERSION="$(npm --version)"
node -e "const [major, minor] = process.argv[1].split('.').map(Number); if (major < 11 || (major === 11 && minor < 5)) process.exit(1)" "$NPM_VERSION"
```

Then install with the package-local lock, run tests and `pack:check`, and run `npm publish` from `packages/create-hx`. Do not set `NODE_AUTH_TOKEN` and do not add `--provenance`; Trusted Publishing supplies short-lived OIDC authentication and automatic provenance.

- [ ] **Step 6: Add independent Dependabot coverage**

Keep the existing root entry and add a second weekly npm update entry for `directory: /packages/create-hx`, grouping all CLI dependencies.

- [ ] **Step 7: Verify GREEN and commit**

```bash
pnpm --dir packages/create-hx --ignore-workspace test
pnpm --dir packages/create-hx --ignore-workspace pack:check
pnpm format:check
pnpm lint
pnpm typecheck
git diff --check
git add packages/create-hx/scripts packages/create-hx/test/package-contents.test.js .github/workflows/create-hx-ci.yml .github/workflows/publish-create-hx.yml .github/dependabot.yml
git commit -m "ci(create-hx): verify and publish CLI package"
```

Expected: every command exits `0` under the bundled Node 24.19.0 runtime.

### Task 9: Final Verification and Release Readiness

**Files:**

- Modify only a file whose behavior fails a check below, and only after adding a regression test that fails for that behavior.

**Interfaces:**

- Consumes: complete CLI, template metadata, and workflows.
- Produces: a verified release candidate and clean worktree.

- [ ] **Step 1: Run CLI coverage and review security branches**

```bash
pnpm --dir packages/create-hx --ignore-workspace test:coverage
```

Expected: all tests PASS. A meaningful uncovered validation, cleanup, or rollback branch receives a focused failing test before any implementation change.

- [ ] **Step 2: Run affected Hx verification**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm tutorial:check
pnpm build
docker compose config --quiet
```

Expected: all commands exit `0`; source tutorial steps and Hx behavior remain intact.

- [ ] **Step 3: Verify packed executable behavior**

```bash
pnpm --dir packages/create-hx --ignore-workspace pack:check
npm_config_cache=/private/tmp/create-hx-npm-cache npm pack --dry-run --json ./packages/create-hx
node packages/create-hx/bin/create-hx.js --help
node packages/create-hx/bin/create-hx.js --version
```

Expected: package contains only metadata, README, `bin/`, and `src/`; help exits `0`; version prints `0.1.0`.

- [ ] **Step 4: Run one live `main` smoke generation**

```bash
CREATE_HX_SMOKE_DIR="$(mktemp -d /private/tmp/create-hx-smoke.XXXXXX)"
rmdir "$CREATE_HX_SMOKE_DIR"
node packages/create-hx/bin/create-hx.js "$CREATE_HX_SMOKE_DIR"
test -f "$CREATE_HX_SMOKE_DIR/apps/api/src/main.ts"
test ! -e "$CREATE_HX_SMOKE_DIR/packages/create-hx"
test ! -e "$CREATE_HX_SMOKE_DIR/docs"
test ! -e "$CREATE_HX_SMOKE_DIR/tutorials"
```

Expected: live public `main` generates successfully and every exclusion assertion passes. Remove only the exact validated `/private/tmp/create-hx-smoke.*` directory afterward.

- [ ] **Step 5: Confirm registry and trusted-publisher prerequisites**

```bash
npm_config_cache=/private/tmp/create-hx-npm-cache npm view create-hx name version --json
```

Expected before first publication: `E404`. The owner must configure repository `SamChowRock/Hx`, workflow filename `publish-create-hx.yml`, and allowed action `npm publish` before pushing a release tag.

- [ ] **Step 6: Inspect final state**

```bash
git diff --check
git status --short
git log --oneline --decorate -10
```

If verification required fixes, each fix already has a regression test observed failing first and is committed with its exact files. If no fixes were needed, create no empty commit.
