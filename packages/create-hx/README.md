# create-hx

Create and safely update a production-oriented Hx NestJS project from the latest Hx `main`
branch.

## Requirements

- Node.js 24.19.0
- pnpm 11.21.0

## Create a project

```bash
pnpm create hx my-app
pnpm create hx .
npm create hx@latest my-app
```

The destination must not exist or must be completely empty. The CLI creates project files and
prints the manual next steps. It does not install dependencies, initialize Git, copy environment
files, start Docker, or run project tests.

## Update an existing project

Run the command inside a generated project:

```bash
pnpm create hx --update
```

Or pass its directory explicitly:

```bash
pnpm create hx --update ./my-app
```

The updater downloads the latest Hx `main` scaffold and compares three states: the previous
template baseline, the files currently in your project, and the incoming template.

- Files that still match the previous template are updated or deleted automatically.
- New incoming files are added when the destination path is free.
- Local edits, local deletions, untracked files, and modified files removed from Hx are preserved.
- If both your project and Hx changed the same path, your file stays untouched and the incoming
  version is written under `.hx-update/incoming/`.
- JSON files, including `package.json`, are compared as ordinary files; they are not automatically
  merged.

Every newly generated project contains `.hx-template-lock.json`. It records SHA-256 hashes and
executable bits for the generated template files. Do not edit it manually. Projects created with
`create-hx@0.1.x` do not have this lock; the updater can adopt them conservatively after verifying
the required Hx scaffold files.

When conflicts exist, `.hx-update/report.json` describes them and the command exits with code `2`.
Merge the incoming versions you want into your project, then remove `.hx-update/` before running
another update. An update without conflicts exits with code `0`; operational errors exit with code
`1`. If Hx removed a file that you modified locally, the file is preserved and recorded in the
report without an incoming copy; review the note and remove `.hx-update/` afterward.

Updating only synchronizes scaffold files. Dependency installation, migrations, application tests,
and release validation remain manual.

---

# 中文说明

`create-hx` 用于从 Hx 最新的 `main` 分支创建项目，也可以把已有项目安全同步到最新脚手架。

## 环境要求

- Node.js 24.19.0
- pnpm 11.21.0

## 创建项目

```bash
pnpm create hx my-app
pnpm create hx .
npm create hx@latest my-app
```

目标目录必须不存在或完全为空。CLI 只创建项目文件并打印后续命令，不会自动安装依赖、初始化
Git、复制环境变量文件、启动 Docker 或运行项目测试。

## 更新已有项目

在生成的项目目录内运行：

```bash
pnpm create hx --update
```

也可以明确指定项目目录：

```bash
pnpm create hx --update ./my-app
```

更新器会下载 Hx `main` 的最新脚手架，并比较三份状态：上一次的模板基线、项目当前文件和最新
模板。

- 仍与旧模板一致的文件会被自动更新或删除。
- 最新模板新增文件且目标路径空闲时，会自动添加。
- 用户修改、用户删除、未跟踪文件，以及被 Hx 删除但用户已经修改的文件都会保留。
- 如果用户和 Hx 同时修改了同一路径，用户文件保持不变，最新模板版本写入
  `.hx-update/incoming/`。
- `package.json` 等 JSON 文件按普通文件比较，不会自动合并字段。

新创建的项目包含 `.hx-template-lock.json`，其中记录模板文件的 SHA-256 哈希和可执行位，请勿
手工修改。由 `create-hx@0.1.x` 创建的旧项目没有这个锁文件；更新器会先验证必要的 Hx 脚手架
文件，再以保守方式接管。

存在冲突时，`.hx-update/report.json` 会记录冲突详情，命令退出码为 `2`。请把需要的
incoming 内容合并回项目，然后删除 `.hx-update/`，之后才能再次更新。无冲突时退出码为 `0`，
普通运行错误退出码为 `1`。如果 Hx 删除了某文件、但该文件已被用户修改，文件会继续保留，并
在报告中记录说明；这种情况没有 incoming 副本，查看说明后删除 `.hx-update/` 即可。

更新命令只同步脚手架文件。依赖安装、数据库迁移、应用测试和发布验证仍需手工执行。
