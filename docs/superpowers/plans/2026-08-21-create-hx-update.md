# create-hx Template Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe `create-hx --update [directory]` workflow that synchronizes the latest Hx `main` scaffold without overwriting user changes.

**Architecture:** Generated projects carry a strict SHA-256 template lock. A pure planner compares the prior baseline, current controlled paths, and a freshly transformed template; a separate transactional writer applies only safe operations and stores incoming conflict versions under `.hx-update/`.

**Tech Stack:** Node.js 24.19 ESM, Node built-in test runner, `node:crypto`, `node:fs/promises`, existing HTTPS downloader and tar pipeline.

**Spec:** `docs/superpowers/specs/2026-08-21-create-hx-update-design.md`

## Global Constraints

- The public package remains independent from the root pnpm workspace.
- Production Node.js support remains `>=24.19.0 <25`; pnpm support remains `>=11.21.0 <12`.
- The only production source remains `https://codeload.github.com/SamChowRock/Hx/tar.gz/refs/heads/main`.
- Never copy `.hx-template/`, `packages/create-hx/`, tutorials, repository docs, or CLI release workflows into projects.
- Never silently overwrite or delete a locally modified file.
- Never recursively delete an unresolved target path.
- Do not install dependencies, initialize Git, run migrations, start Docker, or run generated-project tests.
- Use test-first red/green cycles and commit only the paths belonging to each task.

---

### Task 1: Update-mode argument and CLI contract

**Files:**

- Modify: `packages/create-hx/src/arguments.js`
- Modify: `packages/create-hx/src/cli.js`
- Modify: `packages/create-hx/test/arguments.test.js`
- Modify: `packages/create-hx/test/scaffold.test.js`

**Interfaces:**

- Produces: `parseArguments(argv, context)` returning `{ mode: 'update', targetPath }` for `--update`.
- Consumes later: `runCli` receives `updateProjectImpl` returning `{ added, updated, deleted, preserved, conflicts }`.

- [ ] **Step 1: Write failing argument tests**

Add tests equivalent to:

```js
assert.deepEqual(parseArguments(['--update'], { cwd, version: '0.2.0' }), {
  mode: 'update',
  targetPath: cwd,
});
assert.deepEqual(parseArguments(['--update', 'service'], { cwd, version: '0.2.0' }), {
  mode: 'update',
  targetPath: path.join(cwd, 'service'),
});
assert.throws(() => parseArguments(['--update', '--update'], context), /only once/);
assert.throws(() => parseArguments(['--update', 'one', 'two'], context), /at most one directory/);
```

- [ ] **Step 2: Run the focused tests and verify red**

Run: `node --test --test-name-pattern='update' test/arguments.test.js`

Expected: FAIL because `--update` is reported as unknown.

- [ ] **Step 3: Implement minimal update parsing**

Parse `--update` before generic unknown-option validation. Remove one exact occurrence, reject duplicates, validate zero-or-one remaining positional directory, and return the resolved target without deriving a new package name.

- [ ] **Step 4: Add failing CLI dispatch and output tests**

Inject `updateProjectImpl`, assert it receives the resolved target and abort signal, and assert a conflict result returns exit `2` with this stable summary:

```text
Updated: 1
Added: 2
Deleted: 3
Preserved: 4
Conflicts: 1
```

- [ ] **Step 5: Implement CLI dispatch and help text**

Add `create-hx --update [directory]` to help, call `updateProjectImpl`, print update summary, print conflict instructions only when `conflicts > 0`, and preserve existing signal/error handling.

- [ ] **Step 6: Run focused tests and commit**

Run: `pnpm test -- test/arguments.test.js test/scaffold.test.js`

Expected: PASS.

Commit paths above with message: `feat(create-hx): add update command contract`.

---

### Task 2: Strict template-state model

**Files:**

- Create: `packages/create-hx/src/template-state.js`
- Create: `packages/create-hx/test/template-state.test.js`

**Interfaces:**

- Produces: `scanTemplateState(rootPath, { projectName }) -> Promise<TemplateState>`.
- Produces: `parseTemplateState(jsonText) -> TemplateState`.
- Produces: `serializeTemplateState(state) -> string`.
- Produces: `fileFingerprint(path) -> Promise<{ sha256, executable } | null>`.
- Produces: `LOCK_FILE_NAME = '.hx-template-lock.json'`.

- [ ] **Step 1: Write failing stable-state tests**

Create temporary files including an executable script. Assert scanning excludes `.hx-template-lock.json` and `.hx-update/`, sorts path keys, hashes bytes, records executable bits, computes the same digest independent of directory enumeration order, and serializes with two spaces plus newline.

- [ ] **Step 2: Run the new test and verify red**

Run: `pnpm test -- test/template-state.test.js`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement scanning and stable digest**

Use `createHash('sha256')`, recursive `readdir({ withFileTypes: true })`, POSIX `/` state paths, and executable `(mode & 0o111) !== 0`. Reject symlinks and all non-file/non-directory entries. Compute `templateDigest` from `JSON.stringify(files)` after stable key ordering.

- [ ] **Step 4: Write failing strict-parser tests**

Reject unsupported schema, unknown keys at every object level, absolute/backslash/traversal paths, lock/conflict paths, malformed hashes, non-boolean executable flags, unsorted/duplicate semantic paths, wrong repository/ref, invalid project name, and a digest mismatch.

- [ ] **Step 5: Implement parsing, freezing, and serialization**

Return recursively frozen copied objects. Never retain caller-owned mutable arrays or objects. Emit the exact source object `{ repository: 'SamChowRock/Hx', ref: 'main' }`.

- [ ] **Step 6: Run focused tests and commit**

Run: `pnpm test -- test/template-state.test.js`

Expected: PASS.

Commit with message: `feat(create-hx): track generated template state`.

---

### Task 3: Generate lock files during initialization

**Files:**

- Modify: `packages/create-hx/src/scaffold.js`
- Modify: `packages/create-hx/test/scaffold.test.js`
- Modify: `packages/create-hx/test/repository-fixture.test.js`
- Modify: `.gitignore`

**Interfaces:**

- Produces: `prepareTemplate({ projectName, signal, ...downloadOptions }) -> { stagingPath, manifest, cleanup }` as an internal orchestration helper.
- Consumes: `scanTemplateState` and `serializeTemplateState` from Task 2.

- [ ] **Step 1: Write a failing initialization-lock test**

After `createProject`, read `.hx-template-lock.json`, parse it with `parseTemplateState`, and assert required generated files are tracked while the lock, `.hx-update`, `.hx-template`, and `packages/create-hx` are absent from `files`.

- [ ] **Step 2: Run scaffold tests and verify red**

Run: `pnpm test -- test/scaffold.test.js test/repository-fixture.test.js`

Expected: FAIL because the lock does not exist.

- [ ] **Step 3: Extract reusable template preparation**

Move download, archive inspection, extraction, transforms, and output verification into one helper that owns its temporary paths and exposes idempotent cleanup. Keep `createProject` target inspection before network access and preserve all current abort boundaries.

- [ ] **Step 4: Write the lock in staging**

Scan transformed staging before the lock exists, serialize the state, write it with mode `0o644`, then commit staging through existing `commitStaging`.

- [ ] **Step 5: Ignore conflict workspace**

Add exactly `/.hx-update/` to the root `.gitignore`; ensure it survives template generation and is covered by the state hash like any other template file.

- [ ] **Step 6: Run focused tests and commit**

Run: `pnpm test -- test/scaffold.test.js test/repository-fixture.test.js`

Expected: PASS.

Commit with message: `feat(create-hx): initialize template lock files`.

---

### Task 4: Pure three-input update planner

**Files:**

- Create: `packages/create-hx/src/update-plan.js`
- Create: `packages/create-hx/test/update-plan.test.js`

**Interfaces:**

- Consumes: fingerprints `{ sha256, executable } | null`.
- Produces: `planTemplateUpdate({ baselineFiles, localFiles, incomingFiles, adopt })`.
- Returns sorted arrays `add`, `replace`, `delete`, `preserve`, `conflicts`, and `adopted` with normalized repository paths and conflict reasons.

- [ ] **Step 1: Encode the comparison matrix as failing table tests**

Cover every row from the spec: unchanged, remote-only change, local-only change, both changed, local deletion, remote deletion, both deletion, incoming addition, identical pre-existing addition, conflicting pre-existing addition, and untracked local file omission.

- [ ] **Step 2: Run planner tests and verify red**

Run: `pnpm test -- test/update-plan.test.js`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the exact comparison matrix**

Use only pure object/set operations. Sort every output list with `localeCompare(path, 'en')`. A local deletion plus changed incoming is a conflict; remote deletion plus changed local is a preserved orphan with no incoming file.

- [ ] **Step 4: Add adoption-mode tests**

With `adopt: true`, assert identical existing files are adopted, absent incoming files are added, differing existing files conflict, and local-only paths are invisible to the plan.

- [ ] **Step 5: Implement adoption mode and defensive copies**

Reject a baseline in adoption mode. Freeze returned entries so transaction code cannot mutate a reviewed plan.

- [ ] **Step 6: Run focused tests and commit**

Run: `pnpm test -- test/update-plan.test.js`

Expected: PASS.

Commit with message: `feat(create-hx): plan safe template updates`.

---

### Task 5: Project inspection and controlled local-state collection

**Files:**

- Create: `packages/create-hx/src/update-target.js`
- Create: `packages/create-hx/test/update-target.test.js`

**Interfaces:**

- Produces: `inspectUpdateTarget(targetPath) -> { targetPath, rootIdentity, projectName, baseline, adoption }`.
- Produces: `collectControlledState(target, incomingState) -> localFiles`.
- Consumes: strict lock parser and `fileFingerprint`.

- [ ] **Step 1: Write failing recognition tests**

Accept a directory with a valid lock. For lockless adoption accept only the required five anchor files and a valid `package.json.name`. Reject roots, files, symlinks, unwritable directories, Hx source trees, invalid locks, unsupported schemas, invalid package names, and lockless unrelated projects.

- [ ] **Step 2: Run target inspection tests and verify red**

Run: `pnpm test -- test/update-target.test.js`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement target inspection**

Use `lstat`, `access(W_OK)`, normalized absolute paths, and `{ dev, ino }` identities. Read at most the lock, package manifest, and adoption anchors before download. Refuse an existing non-empty `.hx-update/` before network access.

- [ ] **Step 4: Write controlled-state tests**

Assert only baseline/incoming union paths are read. Return `null` for missing paths, fingerprints for regular files, and reject directories, symlinks, devices, or paths whose ancestors escape through symlinks.

- [ ] **Step 5: Implement controlled-state collection**

Walk each repository path component with `lstat`; require intermediate directories and final regular files. Recheck root identity before and after collection.

- [ ] **Step 6: Run focused tests and commit**

Run: `pnpm test -- test/update-target.test.js`

Expected: PASS.

Commit with message: `feat(create-hx): inspect update targets safely`.

---

### Task 6: Transactional update writer and rollback

**Files:**

- Modify: `packages/create-hx/src/update-target.js`
- Modify: `packages/create-hx/test/update-target.test.js`

**Interfaces:**

- Produces: `commitTemplateUpdate({ target, templatePath, incomingState, plan, signal, operations }) -> summary`.
- The optional `operations` seam exposes `lstat`, `rename`, `mkdir`, `readdir`, and file-copy primitives for deterministic race/failure tests.

- [ ] **Step 1: Write the successful transaction tests**

Build a real target and staging tree. Assert add, replace, delete, executable-bit change, preserved user edit, incoming conflict copy, `report.json`, empty-directory pruning, and lock-last replacement.

- [ ] **Step 2: Run focused transaction tests and verify red**

Run: `node --test --test-name-pattern='transaction' test/update-target.test.js`

Expected: FAIL because the writer is absent.

- [ ] **Step 3: Implement staged transaction and conflict report**

Allocate a random sibling transaction directory. Prepare every new file and report before touching the target. Recheck root, ancestors, types, hashes, modes, and inode identities before each operation. Rename originals into backup, rename prepared files into place, and install the new lock last.

- [ ] **Step 4: Write rollback and race tests**

Inject failure after add, replace, delete, conflict creation, and lock replacement. Replace a target file between verification and rename. Replace a written path during rollback. Assert original content returns, unrelated replacement survives, backup is preserved under `.create-hx-preserved-<uuid>`, and no recursive target deletion occurs.

- [ ] **Step 5: Implement guarded rollback**

Record identities for every moved or created entry. Quarantine written entries before restoring backups. If identities differ, preserve both and return an actionable rollback error. Remove only verified empty directories created by the transaction.

- [ ] **Step 6: Add abort tests and implement signal checks**

Abort before commit and between each operation class. Use the same rollback path and assert exit-relevant abort errors do not leave `.hx-update`, a new lock, or partial safe updates.

- [ ] **Step 7: Run focused tests and commit**

Run: `pnpm test -- test/update-target.test.js`

Expected: PASS.

Commit with message: `feat(create-hx): apply updates transactionally`.

---

### Task 7: End-to-end updater orchestration

**Files:**

- Modify: `packages/create-hx/src/scaffold.js`
- Modify: `packages/create-hx/src/cli.js`
- Modify: `packages/create-hx/test/scaffold.test.js`
- Modify: `packages/create-hx/test/repository-fixture.test.js`

**Interfaces:**

- Produces: `updateProject({ targetPath, signal, sourceUrl, downloadOptions, temporaryDirectory, downloadImpl }) -> summary`.
- Consumes: template preparation, target inspection, state collection, pure planner, and transactional writer.

- [ ] **Step 1: Write a failing local-HTTPS update integration test**

Create version-one and version-two archives. Initialize from version one, edit one tracked file, delete another, add a user file, then update from version two. Assert safe update/add/delete, user preservation, incoming conflict, lock advancement, summary counts, and second-run refusal until `.hx-update` is removed.

- [ ] **Step 2: Run integration tests and verify red**

Run: `pnpm test -- test/scaffold.test.js`

Expected: FAIL because `updateProject` is absent.

- [ ] **Step 3: Implement updater orchestration**

Inspect target and reject pending conflicts before downloading. Prepare the incoming template with the stable lock project name, collect local controlled state, plan, commit, clean all temporary directories in `finally`, and return immutable summary counts.

- [ ] **Step 4: Add lockless adoption integration test**

Remove the v1 lock, make one local difference, and update. Assert adoption adds absent files, preserves and conflicts existing differences, writes a valid v2 lock, and refuses a non-Hx directory before invoking the downloader.

- [ ] **Step 5: Add failure and signal integration tests**

Cover download, archive, manifest, transform, state and plan failures with zero target writes; cover abort after download and during commit with cleanup and signal exit codes.

- [ ] **Step 6: Extend repository fixture to two snapshots**

Build a local archive from the checkout, initialize, create a modified second fixture archive, update, and assert mandatory exclusions remain absent from both generated and incoming conflict trees.

- [ ] **Step 7: Run integration tests and commit**

Run: `pnpm test -- test/scaffold.test.js test/repository-fixture.test.js`

Expected: PASS.

Commit with message: `feat(create-hx): synchronize existing projects`.

---

### Task 8: Documentation, version, packaging, and release workflow compatibility

**Files:**

- Modify: `packages/create-hx/README.md`
- Modify: `packages/create-hx/package.json`
- Modify: `packages/create-hx/pnpm-lock.yaml`
- Modify: `packages/create-hx/test/package-contents.test.js`
- Modify: `packages/create-hx/test/workflow.test.js`

**Interfaces:**

- Publishes `create-hx@0.2.0` with unchanged package name and executable name.

- [ ] **Step 1: Write failing package metadata assertions**

Assert version `0.2.0`, bin value `bin/create-hx.js`, runtime package contents include the three new source modules, and workflow tag validation accepts only `create-hx-v0.2.0` for this version.

- [ ] **Step 2: Run package tests and verify red**

Run: `pnpm test -- test/package-contents.test.js test/workflow.test.js`

Expected: FAIL on old version/bin/runtime allowlist.

- [ ] **Step 3: Update metadata and lockfile**

Set version `0.2.0`, normalize the bin path, and update the package-local lock using pnpm 11.21 with workspace discovery disabled. Do not add runtime dependencies.

- [ ] **Step 4: Document update behavior**

Add creation and update examples, explain `.hx-template-lock.json`, the safe comparison rules, `.hx-update` resolution, exit code `2`, old-project adoption, and the fact that dependency installation remains manual.

- [ ] **Step 5: Run package tests and pack check**

Run: `pnpm test && pnpm pack:check`

Expected: all CLI tests pass and exactly the approved runtime files are packed.

- [ ] **Step 6: Commit**

Commit paths above with message: `docs(create-hx): document safe template updates`.

---

### Task 9: Full verification and release handoff

**Files:**

- Verify all changed files; modify only when a verification failure proves a scoped defect.

**Interfaces:**

- Produces a clean, tested `create-hx@0.2.0` branch ready for local merge and later `create-hx-v0.2.0` release.

- [ ] **Step 1: Run CLI tests with coverage**

Run: `pnpm test:coverage`

Expected: zero failures and no regression below the existing line/branch coverage baseline.

- [ ] **Step 2: Run package and executable smoke checks**

Run: `pnpm pack:check`, `node bin/create-hx.js --help`, and `node bin/create-hx.js --version` from `packages/create-hx`.

Expected: pack guard passes, help contains update syntax, version prints `0.2.0`.

- [ ] **Step 3: Run root repository verification**

Run from repository root:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm tutorial:check
docker compose config --quiet
git diff --check
```

Expected: every command exits `0`.

- [ ] **Step 4: Run a real local archive smoke test**

Generate a project from a tarball of the current checkout, mutate one tracked file, generate a second archive fixture with one safe update, and run `--update`. Confirm the safe file updates, the mutation is preserved, and the lock advances.

- [ ] **Step 5: Review status and commit verification-only fixes if any**

Use explicit `git add -- <paths>` and a scoped fix commit. Do not commit generated projects, tarballs, `.hx-update`, temporary npm credentials, or package tarballs.

- [ ] **Step 6: Prepare release handoff**

Report test totals, coverage, package contents, current branch, commits, and the required external actions: npm Trusted Publisher binding followed by the `create-hx-v0.2.0` tag. Do not publish or push without explicit authorization.
