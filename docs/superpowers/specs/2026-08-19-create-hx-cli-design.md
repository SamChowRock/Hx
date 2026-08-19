# `create-hx` CLI Design

**Date:** 2026-08-19

**Status:** Approved in conversation; awaiting written-spec review

## Summary

Add an independently published npm initializer named `create-hx` to the Hx repository. The CLI creates a runnable Hx-based project in a new or empty directory without copying the repository's tutorials, long-form documentation, blueprint, template metadata, or the CLI package itself.

The CLI does not bundle a second copy of the scaffold. Each invocation downloads the current `main` branch archive from the public `SamChowRock/Hx` GitHub repository, reads the template manifest contained in that archive, stages a filtered project, applies a small set of project-specific transformations, and commits the completed result to the requested directory.

## Goals

- Support these initializer forms:

  ```bash
  pnpm create hx my-app
  pnpm create hx .
  npm create hx@latest my-app
  ```

- Publish the CLI as the independent public npm package `create-hx`.
- Keep the CLI source in `packages/create-hx/` in this repository without adding it to the Hx pnpm workspace.
- Use the latest Hx `main` branch as the template source on every invocation.
- Generate only scaffold-relevant application code, tests, migrations, tooling, and runtime configuration.
- Never copy `packages/create-hx/` into a generated project.
- Refuse to write into a non-empty directory and never overwrite an existing file.
- Leave dependency installation and Git initialization to the user.
- Produce actionable errors and clean up partial work.

## Non-goals

- Bundling the scaffold inside the npm package.
- Producing reproducible historical templates from a fixed tag or commit.
- Supporting a public `--ref`, `--force`, `--install`, `--git`, or repository override option in the first release.
- Interactive feature selection or optional Hx modules.
- Supporting private GitHub repositories or GitHub authentication.
- Running `pnpm install`, `git init`, database migrations, Docker, or application tests on behalf of the user.
- Publishing the package from a developer workstation as part of the CLI implementation.
- Choosing or changing the repository's software license.

## Repository Layout and Package Boundary

The change introduces these source-owned areas:

```text
.hx-template/
  manifest.json
  README.md
packages/create-hx/
  bin/create-hx.js
  src/
  test/
  package.json
  pnpm-lock.yaml
  README.md
.github/workflows/
  create-hx-ci.yml
  publish-create-hx.yml
```

`packages/create-hx/` has its own package metadata, dependency lock, scripts, tests, and npm version. It is deliberately not added to `pnpm-workspace.yaml`. This prevents CLI dependencies and a `packages/create-hx` importer from entering the scaffold's root `pnpm-lock.yaml`.

The existing root workspace remains limited to `apps/*` and `libs/*`. Root formatting and lint rules may still inspect CLI source where their existing file globs apply, but dependency installation and CLI tests run from `packages/create-hx/` with workspace discovery disabled.

The CLI package is buildless ESM targeting Node.js `>=24.19.0 <25`, matching the generated Hx project's engine requirement. Its npm `files` list contains only the executable, runtime source, and package README. Test fixtures, tests, the package-local lockfile, and repository template metadata are not published.

## Template Ownership Model

Hx remains the single source of truth for scaffold code. `.hx-template/` contains only the metadata and small overlay that cannot be copied verbatim from the source repository:

- `manifest.json` describes exclusions, required output paths, the README overlay, source-only text blocks, and `package.json` transformations.
- `README.md` is the concise README written to the generated project root.

The manifest uses explicit path prefixes rather than glob patterns. A path prefix matches either the exact path or its descendants, never a similarly named sibling. Its initial conceptual shape is:

```json
{
  "schemaVersion": 1,
  "exclude": [
    ".hx-template",
    ".github/workflows/create-hx-ci.yml",
    ".github/workflows/publish-create-hx.yml",
    "BACKEND_SCAFFOLD_BLUEPRINT.md",
    "docs",
    "packages/create-hx",
    "scripts/tutorial",
    "tutorials"
  ],
  "required": [
    ".env.example",
    "apps/api/src/main.ts",
    "apps/worker/src/main.ts",
    "docker-compose.yml",
    "package.json",
    "pnpm-lock.yaml",
    "prisma/schema.prisma"
  ],
  "overrides": {
    "README.md": ".hx-template/README.md"
  },
  "stripBlocks": {
    ".github/workflows/ci.yml": ["tutorial"]
  },
  "packageJson": {
    "removeScriptPrefixes": ["tutorial:"]
  }
}
```

The checked-in manifest is authoritative; the CLI accepts only `schemaVersion: 1`. Unknown top-level fields are rejected so a manifest change cannot silently produce an incorrectly transformed project with an older CLI.

Most future scaffold files flow into generated projects automatically. Contributors update the exclusion list only when adding source-only repository content. This favors low maintenance over historical reproducibility, consistent with following `main`.

## Source-only Blocks and Overlays

The Hx source workflow keeps its tutorial verification. Tutorial-only steps in `.github/workflows/ci.yml` are enclosed by paired comments:

```yaml
# hx-template:exclude-start tutorial
# source-only tutorial steps
# hx-template:exclude-end tutorial
```

The template transformer removes the markers and all content between a matching pair. It rejects nested blocks, duplicate open blocks, unmatched markers, unknown block names, and files that do not contain every block requested by the manifest. This makes source workflow drift fail loudly instead of leaking broken CI into generated projects.

The generated README comes from `.hx-template/README.md`. It contains only the project name, prerequisites, setup commands, local service addresses, verification commands, and a short description of the API and Worker. It contains no tutorial links, milestone narrative, blueprint references, or references to `.hx-template/`.

The README overlay contains one exact `{{PROJECT_NAME}}` token. The transformer requires exactly one occurrence and replaces it with the validated project name. No other overlay token syntax is supported.

`package.json` is parsed structurally. The transformer:

- replaces `name` with the validated target directory basename;
- preserves `private`, `version`, engines, dependencies, dev dependencies, and all non-tutorial scripts;
- removes every script whose key starts with `tutorial:`;
- serializes the result with the repository's existing two-space JSON formatting and a trailing newline.

No textual search-and-replace is applied to arbitrary source files.

## Command-line Contract

The public syntax is:

```text
create-hx [directory]
create-hx --help
create-hx --version
```

`directory` defaults to `.`. It may be a relative or absolute path. The CLI resolves it against the current working directory and uses the final path component as the generated npm package name.

The package name must already be a valid unscoped, lowercase npm name. The CLI does not silently normalize uppercase letters, spaces, non-ASCII characters, leading dots, or other invalid characters. A validation failure reports the derived name and asks the user to choose a lowercase directory such as `my-app`.

Unknown options, multiple directory arguments, and a missing value produced by malformed invocation are usage errors. Usage errors exit with status `1`; `--help` and `--version` exit with status `0`.

The first release is non-interactive and has no force mode.

## Target-directory Safety

Before making a network request, the CLI resolves and inspects the target:

- A missing target is allowed when its parent exists and is writable.
- An existing target must be a directory and contain zero entries.
- Hidden files, `.DS_Store`, `.gitkeep`, and a pre-existing `.git/` directory all make the target non-empty.
- An existing file, dangling symbolic link, or non-directory target is rejected.
- A target resolving to a filesystem root is rejected even if an unusual environment reports it as empty.

Immediately before committing staged output, the CLI checks the target again. If another process has added content, initialization aborts without overwriting it.

For a target that did not exist, staging occurs in a randomly named sibling directory on the same filesystem and the completed directory is renamed into place. For an existing empty target such as `.`, files are copied only after validation. The copy operation records every path it creates; on failure it removes recorded files individually and removes recorded directories only with a non-recursive empty-directory operation. It preserves any unrelated path that appeared concurrently. The CLI never recursively deletes an unresolved path or the target directory supplied by the user.

## Download and Archive Processing

The fixed source URL is the GitHub codeload tarball for `SamChowRock/Hx` at `refs/heads/main`. The repository is public, and the first release has no token support.

The downloader:

- accepts HTTPS only;
- follows at most five HTTPS redirects;
- rejects non-2xx terminal responses;
- applies a 30-second inactivity timeout;
- aborts after 100 MiB of compressed data;
- writes the response to a randomly named temporary file;
- removes the temporary file on success, error, `SIGINT`, or `SIGTERM`.

The complete tarball necessarily contains `packages/create-hx/` in its compressed network payload. Archive scanning and extraction filters ensure that this directory is never materialized in the staging directory or generated project.

Archive processing has two read passes over the downloaded file:

1. Locate and parse `.hx-template/manifest.json` and the overlay files referenced by it without extracting repository entries.
2. Extract allowed entries into staging after validating the manifest.

GitHub archives contain a generated leading directory. The archive reader strips exactly one common leading component and validates every normalized repository-relative path. It accepts regular files and directories only. It rejects absolute paths, Windows drive paths, NUL bytes, empty normalized paths, `.`/`..` traversal, symbolic links, hard links, devices, FIFOs, and archive entries outside the single common root.

The extractor preserves executable permission bits needed by files such as `.husky/pre-commit`, while not preserving archive ownership. Metadata and overlay files have a 1 MiB uncompressed size limit each. Duplicate file paths are rejected.

## Staging, Transformation, and Commit Flow

One orchestration function owns the initialization lifecycle:

1. Parse arguments and derive the project name.
2. Validate the target path and its emptiness.
3. Allocate temporary download and sibling staging paths.
4. Download the `main` archive.
5. Read and validate manifest version 1 and its referenced overlays.
6. Extract allowed regular files and directories into staging.
7. Apply block removal, README override, and structural `package.json` changes.
8. Verify every manifest `required` path exists with the expected file type.
9. Verify excluded path prefixes, `.hx-template/`, and `packages/create-hx/` are absent.
10. Recheck that the target is still eligible.
11. Commit staged output to the target.
12. Clean temporary state and print next steps.

No target files are written before steps 1 through 9 succeed.

## Success Output

On success, the CLI prints the resolved project location and manual next steps. For a named child directory the commands are:

```bash
cd my-app
git init
pnpm install
cp .env.example .env
docker compose up --build -d
```

For `.` it omits the `cd` command. Git initialization appears before dependency installation because the retained Husky `prepare` script expects a Git repository. The CLI prints commands only; it does not execute them.

## Error Handling and Exit Behavior

Expected failures use a concise `Error: <message>` format on stderr and exit status `1`. They include:

- invalid arguments or package name;
- missing or unwritable parent directory;
- existing non-empty target;
- DNS, connection, redirect, timeout, response-status, and size-limit failures;
- corrupt or unsupported tar archives;
- missing, malformed, unsupported, or internally inconsistent manifests;
- unsafe or duplicate archive entries;
- missing required scaffold output;
- transformation marker or JSON failures;
- target races and filesystem write errors.

Expected errors do not print a stack trace. Unexpected programmer errors include a stack only when `CREATE_HX_DEBUG=1` is present. Signal handling aborts active I/O, performs bounded cleanup, and returns conventional non-zero signal-related status.

The error text never includes response bodies, environment values, tokens, or full archive contents.

## Component Interfaces

The source is split by responsibility:

- `bin/create-hx.js` calls the application entry point, writes final output, and assigns the process exit code.
- `src/arguments.js` parses the supported arguments and returns the resolved target and project name.
- `src/download.js` downloads one HTTPS resource into a caller-owned temporary path.
- `src/archive.js` reads metadata entries and extracts validated output entries.
- `src/manifest.js` validates schema version 1 and exposes exact path-prefix predicates.
- `src/transform.js` applies manifest-declared block, overlay, and `package.json` transformations.
- `src/scaffold.js` coordinates validation, staging, commit, rollback, cleanup, and success instructions.

Production modules accept injected filesystem paths, a download URL, output writers, TLS trust, and resource limits through internal function parameters where needed for tests. Production defaults always enforce the fixed HTTPS URL, normal platform trust store, 30-second inactivity timeout, and 100 MiB limit. The public CLI does not expose these seams as options.

## Testing Strategy

The CLI uses Node's built-in test runner and real filesystem/archive behavior. Network tests use a local HTTPS server with a per-test certificate authority passed through the internal TLS seam rather than mocking request behavior. Each behavior is developed test-first.

### Unit and focused integration coverage

- default `.` and explicit relative/absolute directory parsing;
- `--help`, `--version`, unknown options, and extra arguments;
- valid and invalid derived npm package names;
- missing, empty, non-empty, hidden-file, file, symlink, and root targets;
- successful download, HTTPS redirect policy, non-2xx response, timeout, oversize response, and interrupted transfer;
- manifest schema, exact prefix matching, unknown fields, missing overlays, and required paths;
- corrupt tarballs, multiple archive roots, path traversal, absolute paths, duplicate paths, symbolic links, and hard links;
- executable-bit preservation;
- README override, block removal success and malformed markers;
- project name replacement and removal of all `tutorial:` scripts;
- commit to a new target, commit to an existing empty target, target race, and rollback after a forced copy failure;
- cleanup after success, expected errors, unexpected errors, and process signals.

### Repository fixture test

A test builds a local tarball from the checked-out repository, runs the initializer against that archive through the internal source-URL seam, and asserts that:

- all manifest-required files exist;
- `docs/`, `tutorials/`, `scripts/tutorial/`, `BACKEND_SCAFFOLD_BLUEPRINT.md`, `.hx-template/`, and `packages/create-hx/` do not exist;
- CLI CI and publish workflows do not exist;
- the generated root package name matches the target directory;
- no `tutorial:` scripts remain;
- no tutorial-only CI markers or commands remain;
- the concise README contains no source documentation links.

This test validates the pull request's local repository contents and does not depend on the remote `main` branch.

### Package-content test

CI runs `npm pack --dry-run --json` from `packages/create-hx/` and asserts that only the declared runtime files and npm-required metadata will be published. The test specifically rejects template source, tests, fixtures, local lockfiles, and repository documents in the npm tarball.

The CLI test suite makes no live GitHub request in required CI. A real `main` smoke run may be performed manually before release, but network availability does not gate ordinary pull requests.

## Continuous Integration

`.github/workflows/create-hx-ci.yml` is source-only and excluded by the manifest. It runs when the CLI package, `.hx-template/`, relevant source workflow markers, or the workflow itself changes. It installs the package-local dependencies with pnpm workspace discovery disabled, then runs CLI tests and the package-content check on Node.js 24.19.0.

The existing Hx workflow continues to test the scaffold and tutorials. Its source-only tutorial steps remain active in the Hx repository; only generated output removes them.

## Independent npm Release

`packages/create-hx/package.json` declares:

- `name: "create-hx"`;
- an independent semantic version beginning at `0.1.0`;
- the executable mapping for `create-hx`;
- `private: false`;
- `publishConfig.access: "public"` and the npm registry;
- the exact public `repository` URL and `directory: "packages/create-hx"`;
- Node.js `>=24.19.0 <25`;
- a restrictive npm `files` list.

`.github/workflows/publish-create-hx.yml` is also source-only. A tag matching `create-hx-vX.Y.Z` triggers it. Before publishing, the workflow:

1. verifies that the tag version exactly matches the package version;
2. installs from the package-local lockfile;
3. runs the full CLI test suite;
4. runs and validates `npm pack --dry-run --json`;
5. publishes to npm through Trusted Publishing/OIDC.

The npm package owner must configure `SamChowRock/Hx` and the exact publish workflow as the trusted publisher, with `npm publish` allowed, before the workflow can succeed. The workflow requests only `contents: read` and `id-token: write`. No long-lived npm token is stored in the repository. The public repository and matching `repository.url` allow npm to attach provenance automatically.

At design time, `npm view create-hx` returns `E404`, indicating no public package currently occupies the name. Availability is rechecked immediately before the first publication; name ownership is established only by a successful publish.

## Maintenance Rules

- Application and platform changes require no CLI release; future invocations read the latest `main` archive.
- Changes to what counts as scaffold content update `.hx-template/manifest.json` in the same pull request.
- Changes to CLI behavior or manifest schema require a new `create-hx` version.
- Breaking manifest changes use a new integer `schemaVersion`; old CLIs fail clearly rather than guessing.
- Source-only workflow additions must be explicitly excluded.
- The repository fixture test is the enforcement point for accidental tutorial, documentation, template metadata, or CLI leakage.

## Trade-offs

Following `main` minimizes synchronization and release work, but it means the same CLI version can produce different source snapshots on different days. A broken `main` can temporarily produce a broken scaffold. This is an accepted product choice.

Downloading a whole GitHub tarball transfers compressed bytes for excluded paths, including `packages/create-hx/`. Filtering prevents those paths from being written, but does not save their network bandwidth. This is accepted in exchange for a single fast, cross-platform download without Git or many GitHub API requests.

Keeping the CLI outside the root pnpm workspace avoids lockfile contamination at the cost of a separate package-local install and CI job. This is accepted because independent packaging and clean generated output are more important than one workspace-wide install command.

## Acceptance Criteria

The feature is complete when all of the following are true:

1. `pnpm create hx my-app`, `pnpm create hx .`, and `npm create hx@latest my-app` resolve to the published `create-hx` executable contract.
2. A local repository archive produces a generated project containing Hx application code, Prisma migrations, tests, Docker/tooling configuration, GitHub scaffold CI, Husky, and the root lockfile.
3. Generated output contains none of the documented excluded paths, especially `packages/create-hx/`.
4. Generated `package.json.name` matches the validated target basename and contains no `tutorial:` script.
5. Generated README and CI contain no tutorial or removed-document references.
6. Existing non-empty targets are rejected before download and no existing entry is changed.
7. Corrupt, unsafe, incomplete, or incompatible downloads leave no scaffold files in the target.
8. The CLI never installs dependencies, initializes Git, or starts services.
9. Unit, archive, filesystem, local HTTP, repository fixture, and package-content tests pass on Node.js 24.19.0.
10. The source-only publish workflow validates the tag, tests the package, checks npm contents, and is ready for npm Trusted Publishing configuration.
