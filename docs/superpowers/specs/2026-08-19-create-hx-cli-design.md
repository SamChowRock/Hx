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

GitHub archives contain a generated leading directory. The archive reader strips exactly one common leading component and validates every normalized repository-relative path. The sole structural entry for that common root directory is ignored; every other empty normalized path is rejected. It accepts regular files and directories only. It rejects absolute paths, Windows drive paths, NUL bytes, `.`/`..` traversal, symbolic links, hard links, devices, FIFOs, and archive entries outside the single common root.

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
9. Unit, archive, filesystem, local HTTPS, repository fixture, and package-content tests pass on Node.js 24.19.0.
10. The source-only publish workflow validates the tag, tests the package, checks npm contents, and is ready for npm Trusted Publishing configuration.

---

# `create-hx` CLI 设计（中文版）

**日期：** 2026-08-19

**状态：** 已在对话中确认，等待书面规格审阅

## 摘要

在 Hx 仓库中新增一个可独立发布到 npm 的初始化工具 `create-hx`。该 CLI 可以在新目录或空目录中创建一个基于 Hx、可运行的项目，同时不复制仓库中的教程、长篇文档、蓝图、模板元数据及 CLI 包自身。

CLI 不会在 npm 包中内置第二份脚手架。每次调用都会从公开的 `SamChowRock/Hx` GitHub 仓库下载当前 `main` 分支归档，读取归档内的模板清单，暂存经过筛选的项目，应用少量项目级转换，然后将完整结果提交到用户指定的目录。

## 目标

- 支持以下初始化调用形式：

  ```bash
  pnpm create hx my-app
  pnpm create hx .
  npm create hx@latest my-app
  ```

- 将 CLI 作为独立的公开 npm 包 `create-hx` 发布。
- 将 CLI 源码保存在当前仓库的 `packages/create-hx/` 中，但不加入 Hx 的 pnpm workspace。
- 每次调用都使用最新的 Hx `main` 分支作为模板来源。
- 生成内容仅包含与脚手架有关的应用代码、测试、Migration、工具配置和运行时配置。
- 绝不把 `packages/create-hx/` 复制到生成项目中。
- 拒绝写入非空目录，并且绝不覆盖现有文件。
- 依赖安装和 Git 初始化交由用户执行。
- 提供可操作的错误信息，并清理未完成的中间产物。

## 非目标

- 把脚手架内置在 npm 包中。
- 从固定 tag 或 commit 生成可复现的历史模板。
- 在首个版本中提供公开的 `--ref`、`--force`、`--install`、`--git` 或仓库覆盖参数。
- 交互式选择功能或可选 Hx 模块。
- 支持私有 GitHub 仓库或 GitHub 身份验证。
- 代替用户运行 `pnpm install`、`git init`、数据库 Migration、Docker 或应用测试。
- 将开发者工作站上的实际发包操作纳入 CLI 实现范围。
- 选择或修改仓库的软件许可证。

## 仓库布局与包边界

本次变更新增以下由源仓库维护的区域：

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

`packages/create-hx/` 拥有自己的包元数据、依赖锁文件、脚本、测试和 npm 版本。它不会加入 `pnpm-workspace.yaml`。这样可以避免 CLI 依赖及 `packages/create-hx` importer 进入脚手架根目录的 `pnpm-lock.yaml`。

现有根 workspace 仍然只包含 `apps/*` 和 `libs/*`。如果根目录的格式化和 Lint 规则现有文件 glob 会匹配 CLI 源码，它们仍可检查这些源码；但 CLI 的依赖安装和测试必须在 `packages/create-hx/` 中执行，并关闭 workspace 自动发现。

CLI 包采用无需构建的 ESM，目标 Node.js 版本为 `>=24.19.0 <25`，与生成的 Hx 项目引擎要求一致。它的 npm `files` 清单只包含可执行文件、运行时源码和包 README。测试 Fixture、测试代码、包自己的锁文件以及仓库模板元数据都不会发布。

## 模板所有权模型

Hx 始终是脚手架代码的唯一事实来源。`.hx-template/` 只保存无法直接从源仓库原样复制的元数据和少量覆盖内容：

- `manifest.json` 描述排除项、输出必需路径、README 覆盖文件、仅供源仓库使用的文本区块，以及 `package.json` 转换。
- `README.md` 是写入生成项目根目录的精简 README。

清单使用明确的路径前缀而不是 glob。一个路径前缀只匹配该路径本身或其后代，不会匹配名称相似的同级路径。初始概念结构如下：

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

仓库中提交的清单具有最终权威性；CLI 只接受 `schemaVersion: 1`。未知的顶层字段会被拒绝，避免清单变化后，旧版 CLI 在没有提示的情况下生成错误转换的项目。

未来新增的大多数脚手架文件都会自动进入生成项目。只有在添加源仓库专用内容时，贡献者才需要更新排除清单。这一设计与跟随 `main` 的选择一致：优先降低维护成本，而不是保证历史可复现性。

## 仅供源仓库使用的区块与覆盖文件

Hx 源仓库工作流继续保留教程验证。`.github/workflows/ci.yml` 中仅供教程使用的步骤由成对注释包围：

```yaml
# hx-template:exclude-start tutorial
# source-only tutorial steps
# hx-template:exclude-end tutorial
```

模板转换器会删除标记及匹配标记之间的所有内容。以下情况都会被拒绝：区块嵌套、重复的开始标记、未配对标记、未知区块名，以及文件中缺少清单要求的任一区块。这样可以让源工作流发生漂移时明确失败，而不是把损坏的 CI 泄漏到生成项目中。

生成项目的 README 来源于 `.hx-template/README.md`。它只包含项目名、前置要求、设置命令、本地服务地址、验证命令，以及 API 和 Worker 的简短说明。它不包含教程链接、里程碑叙述、蓝图引用或 `.hx-template/` 引用。

README 覆盖文件中包含一个且仅有一个精确的 `{{PROJECT_NAME}}` token。转换器要求它恰好出现一次，并将其替换为已经校验的项目名。不支持其他覆盖 token 语法。

`package.json` 以结构化方式解析。转换器会：

- 将 `name` 替换为已经校验的目标目录 basename；
- 保留 `private`、`version`、engines、dependencies、devDependencies 以及所有非教程脚本；
- 删除 key 以 `tutorial:` 开头的所有脚本；
- 继续使用仓库现有的两个空格 JSON 格式，并在文件末尾保留换行。

不会对任意源码文件执行文本搜索替换。

## 命令行契约

公开语法如下：

```text
create-hx [directory]
create-hx --help
create-hx --version
```

`directory` 默认值为 `.`，可以是相对路径或绝对路径。CLI 根据当前工作目录解析它，并使用路径最后一段作为生成项目的 npm 包名。

包名必须已经是合法、无 scope、小写的 npm 名称。CLI 不会静默规范化大写字母、空格、非 ASCII 字符、前导点或其他非法字符。校验失败时会报告派生出的名称，并要求用户选择类似 `my-app` 的小写目录名。

未知选项、多个目录参数，以及由错误调用产生的缺失参数值都属于用法错误。用法错误以状态码 `1` 退出；`--help` 和 `--version` 以状态码 `0` 退出。

首个版本无交互流程，也没有强制覆盖模式。

## 目标目录安全

发出网络请求之前，CLI 会解析并检查目标路径：

- 目标不存在时，仅当父目录存在且可写才允许继续。
- 目标已经存在时，它必须是目录，并且包含零个条目。
- 隐藏文件、`.DS_Store`、`.gitkeep` 和已有的 `.git/` 目录都会使目标被视为非空。
- 目标为已有文件、悬空符号链接或非目录类型时会被拒绝。
- 即使某个异常环境把文件系统根目录报告为空，解析到文件系统根目录的目标也会被拒绝。

提交暂存输出之前，CLI 会再次检查目标。如果其他进程已经添加了内容，初始化会中止且不会覆盖这些内容。

如果目标原本不存在，staging 会在同一文件系统的目标同级位置使用随机名称目录，完成后通过重命名提交到目标位置。对于 `.` 这类已经存在的空目录，只有在所有校验完成后才复制文件。复制操作会记录自己创建的每条路径；失败时逐个删除记录的文件，并且只使用非递归的空目录删除操作移除记录的目录。其他进程并发添加的无关路径会被保留。CLI 绝不会递归删除未解析路径或用户指定的目标目录。

## 下载与归档处理

固定来源 URL 是 `SamChowRock/Hx` GitHub codeload 上 `refs/heads/main` 对应的 tarball。该仓库公开，首个版本不支持 token。

下载器会：

- 只接受 HTTPS；
- 最多跟随五次 HTTPS 重定向；
- 拒绝最终的非 2xx 响应；
- 应用 30 秒无活动超时；
- 压缩数据超过 100 MiB 时中止；
- 将响应写入随机命名的临时文件；
- 在成功、错误、`SIGINT` 或 `SIGTERM` 时删除临时文件。

完整 tarball 的压缩网络载荷中必然包含 `packages/create-hx/`。归档扫描和解包过滤会确保这个目录永远不会实际写入 staging 目录或生成项目。

归档处理会对下载文件执行两次读取：

1. 定位并解析 `.hx-template/manifest.json` 及其引用的覆盖文件，但不解包仓库条目。
2. 校验清单后，将允许的条目解包到 staging。

GitHub 归档包含自动生成的顶层目录。归档读取器只移除一个公共顶层组件，并校验每个规范化后的仓库相对路径。唯一的公共根目录结构条目会被忽略；除此以外，任何规范化后为空的路径都会被拒绝。只接受普通文件和目录。绝对路径、Windows 盘符路径、NUL 字节、`.`/`..` 穿越、符号链接、硬链接、设备文件、FIFO，以及单一公共根目录之外的归档条目都会被拒绝。

解包器保留 `.husky/pre-commit` 等文件所需的可执行权限位，但不保留归档中的所有者信息。每个元数据或覆盖文件的未压缩大小上限为 1 MiB。重复文件路径会被拒绝。

## 暂存、转换与提交流程

一个编排函数负责完整初始化生命周期：

1. 解析参数并派生项目名。
2. 校验目标路径及其空目录状态。
3. 分配临时下载路径和同级 staging 路径。
4. 下载 `main` 归档。
5. 读取并校验版本 1 清单及其引用的覆盖文件。
6. 将允许的普通文件和目录解包到 staging。
7. 应用区块删除、README 覆盖和结构化 `package.json` 修改。
8. 校验清单中每个 `required` 路径都存在且文件类型正确。
9. 校验所有排除路径前缀、`.hx-template/` 和 `packages/create-hx/` 均不存在。
10. 再次检查目标仍然符合写入条件。
11. 将 staging 输出提交到目标。
12. 清理临时状态并打印下一步操作。

第 1 至第 9 步全部成功之前，不会写入任何目标文件。

## 成功输出

成功时，CLI 会打印解析后的项目位置以及需要手动执行的后续步骤。对于命名的子目录，命令如下：

```bash
cd my-app
git init
pnpm install
cp .env.example .env
docker compose up --build -d
```

目标为 `.` 时会省略 `cd` 命令。Git 初始化出现在依赖安装之前，因为保留的 Husky `prepare` 脚本需要 Git 仓库。CLI 只打印这些命令，不会执行它们。

## 错误处理与退出行为

可预期错误使用简洁的 `Error: <message>` 格式写入 stderr，并以状态码 `1` 退出，包括：

- 参数或包名无效；
- 父目录不存在或不可写；
- 目标目录已经存在且非空；
- DNS、连接、重定向、超时、响应状态和大小限制失败；
- tar 归档损坏或不受支持；
- 清单缺失、格式错误、版本不受支持或内部不一致；
- 不安全或重复的归档条目；
- 必需脚手架输出缺失；
- 转换标记或 JSON 处理失败；
- 目标竞态及文件系统写入错误。

可预期错误不打印 stack trace。只有存在 `CREATE_HX_DEBUG=1` 时，未预期的程序错误才会包含 stack。信号处理会中止活动 I/O、执行有界清理，并返回惯用的非零信号相关状态码。

错误文本永远不包含响应 body、环境值、token 或完整归档内容。

## 组件接口

源码按职责拆分：

- `bin/create-hx.js` 调用应用入口、写入最终输出并设置进程退出码。
- `src/arguments.js` 解析受支持的参数，并返回解析后的目标和项目名。
- `src/download.js` 把一个 HTTPS 资源下载到调用方拥有的临时路径。
- `src/archive.js` 读取元数据条目，并解包通过校验的输出条目。
- `src/manifest.js` 校验版本 1 schema，并提供精确的路径前缀判断能力。
- `src/transform.js` 应用清单声明的区块、覆盖文件及 `package.json` 转换。
- `src/scaffold.js` 协调校验、暂存、提交、回滚、清理和成功提示。

为了测试，生产模块可通过内部函数参数注入文件系统路径、下载 URL、输出 writer、TLS 信任设置和资源限制。生产默认值始终强制使用固定 HTTPS URL、平台正常信任库、30 秒无活动超时和 100 MiB 限制。这些 seam 不会作为公开 CLI 选项暴露。

## 测试策略

CLI 使用 Node 内置 test runner 和真实的文件系统、归档行为。网络测试使用本地 HTTPS 服务器，并通过内部 TLS seam 传入每个测试专用的证书颁发机构，而不是 mock 请求行为。每项行为都采用测试先行方式开发。

### 单元测试与聚焦集成测试覆盖

- 默认 `.` 以及显式相对/绝对目录解析；
- `--help`、`--version`、未知选项和额外参数；
- 有效和无效的派生 npm 包名；
- 不存在、空、非空、包含隐藏文件、文件、符号链接和根目录目标；
- 成功下载、HTTPS 重定向策略、非 2xx 响应、超时、超大响应和中断传输；
- 清单 schema、精确前缀匹配、未知字段、覆盖文件缺失和必需路径；
- 损坏 tarball、多个归档根、路径穿越、绝对路径、重复路径、符号链接和硬链接；
- 可执行权限位保留；
- README 覆盖、区块删除成功和错误标记；
- 项目名替换和删除全部 `tutorial:` 脚本；
- 提交到新目标、提交到已有空目标、目标竞态，以及强制复制失败后的回滚；
- 成功、可预期错误、未预期错误和进程信号之后的清理。

### 仓库 Fixture 测试

一个测试会根据当前 checkout 的仓库构建本地 tarball，通过内部 source URL seam 运行初始化器，并断言：

- 清单要求的所有文件均存在；
- `docs/`、`tutorials/`、`scripts/tutorial/`、`BACKEND_SCAFFOLD_BLUEPRINT.md`、`.hx-template/` 和 `packages/create-hx/` 均不存在；
- CLI CI 和发布工作流不存在；
- 生成的根包名与目标目录一致；
- 不存在任何 `tutorial:` 脚本；
- 不存在仅供教程使用的 CI 标记或命令；
- 精简 README 不包含源仓库文档链接。

该测试验证 pull request 中的本地仓库内容，不依赖远程 `main` 分支。

### 包内容测试

CI 在 `packages/create-hx/` 中运行 `npm pack --dry-run --json`，并断言即将发布的内容只有声明的运行时文件和 npm 必需元数据。测试会明确拒绝 npm tarball 中出现模板源码、测试、Fixture、本地锁文件和仓库文档。

CLI 必需测试不会实时请求 GitHub。发布前可以手动对真实 `main` 执行 smoke test，但普通 pull request 不会依赖网络可用性。

## 持续集成

`.github/workflows/create-hx-ci.yml` 仅供源仓库使用，并由清单排除。CLI 包、`.hx-template/`、相关源工作流标记或该工作流自身发生变化时，它都会运行。它会关闭 pnpm workspace 自动发现来安装包本地依赖，然后在 Node.js 24.19.0 上运行 CLI 测试和包内容检查。

现有 Hx 工作流继续测试脚手架和教程。其中仅供源仓库使用的教程步骤在 Hx 仓库中保持启用；只有生成输出会移除这些步骤。

## 独立 npm 发布

`packages/create-hx/package.json` 声明：

- `name: "create-hx"`；
- 从 `0.1.0` 开始的独立语义版本；
- `create-hx` 的可执行文件映射；
- `private: false`；
- `publishConfig.access: "public"` 和 npm registry；
- 准确的公开 `repository` URL 和 `directory: "packages/create-hx"`；
- Node.js `>=24.19.0 <25`；
- 严格限制的 npm `files` 清单。

`.github/workflows/publish-create-hx.yml` 同样只供源仓库使用。匹配 `create-hx-vX.Y.Z` 的 tag 会触发它。发布前，工作流会：

1. 校验 tag 版本与包版本完全一致；
2. 根据包自己的锁文件安装依赖；
3. 运行完整 CLI 测试套件；
4. 运行并校验 `npm pack --dry-run --json`；
5. 通过 Trusted Publishing/OIDC 发布到 npm。

工作流成功之前，npm 包所有者必须把 `SamChowRock/Hx` 及准确的发布工作流配置为 trusted publisher，并允许 `npm publish`。工作流只申请 `contents: read` 和 `id-token: write` 权限。仓库中不保存长期 npm token。公开仓库及匹配的 `repository.url` 使 npm 可以自动附加 provenance。

在设计阶段，`npm view create-hx` 返回 `E404`，说明目前没有公开包占用该名称。首次发布前必须再次检查可用性；只有成功发布后才能确立名称所有权。

## 维护规则

- 应用和平台变化不要求发布新版 CLI；未来调用会读取最新 `main` 归档。
- “哪些内容属于脚手架”发生变化时，在同一个 pull request 中更新 `.hx-template/manifest.json`。
- CLI 行为或 manifest schema 发生变化时，需要发布新的 `create-hx` 版本。
- 破坏性清单变化使用新的整数 `schemaVersion`；旧版 CLI 会明确失败，而不会猜测处理方式。
- 新增仅供源仓库使用的工作流时，必须显式排除。
- 仓库 Fixture 测试负责阻止教程、文档、模板元数据或 CLI 被意外带入生成项目。

## 权衡

跟随 `main` 可以把同步和发布工作降到最低，但也意味着同一 CLI 版本在不同日期可能生成不同的源码快照。损坏的 `main` 可能暂时生成损坏的脚手架。这是已经接受的产品选择。

下载完整 GitHub tarball 会传输被排除路径的压缩数据，其中包括 `packages/create-hx/`。过滤可以阻止这些路径写入磁盘，但不能节省其网络带宽。我们接受这一点，以换取无需 Git、无需大量 GitHub API 请求、单次完成且跨平台的快速下载。

让 CLI 位于根 pnpm workspace 之外，可以避免锁文件污染，代价是需要单独的包本地安装和 CI job。我们接受这一点，因为独立发包和干净的生成输出比单一的 workspace 全局安装命令更重要。

## 验收条件

满足以下全部条件时，功能才算完成：

1. `pnpm create hx my-app`、`pnpm create hx .` 和 `npm create hx@latest my-app` 都能解析到已发布的 `create-hx` 可执行契约。
2. 本地仓库归档可以生成一个包含 Hx 应用代码、Prisma Migration、测试、Docker/工具配置、GitHub 脚手架 CI、Husky 和根锁文件的项目。
3. 生成输出不包含任何已记录的排除路径，尤其是 `packages/create-hx/`。
4. 生成的 `package.json.name` 与已校验的目标 basename 一致，并且不存在任何 `tutorial:` 脚本。
5. 生成的 README 和 CI 不包含教程引用或已删除文档的引用。
6. 下载前拒绝已有的非空目标，并且不修改任何现有条目。
7. 损坏、不安全、不完整或不兼容的下载不会在目标中留下脚手架文件。
8. CLI 永远不会安装依赖、初始化 Git 或启动服务。
9. 单元、归档、文件系统、本地 HTTPS、仓库 Fixture 和包内容测试在 Node.js 24.19.0 上全部通过。
10. 仅供源仓库使用的发布工作流能够校验 tag、测试包、检查 npm 内容，并且已经准备好配置 npm Trusted Publishing。
