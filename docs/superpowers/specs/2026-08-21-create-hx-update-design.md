# create-hx 模板同步设计

## 目标

为 `create-hx` 增加安全的模板同步能力，让使用者可以把 Hx `main` 中新的脚手架改动同步到已有项目，同时不静默覆盖业务代码或用户配置。

公开命令为：

```bash
pnpm create hx --update
pnpm create hx --update ./my-project
```

目录参数默认是当前目录。现有初始化命令、实时下载 `main`、不自动安装依赖和不自动初始化 Git 的行为保持不变。

## 非目标

- 不自动合并两个同时修改过的文本或 JSON 文件。
- 不维护 Hx 历史模板快照，也不要求生成项目安装 Git。
- 不覆盖用户新增文件、用户修改文件或用户主动删除的模板文件。
- 不增加 `--force`、远程仓库、分支或提交选择参数。
- 不运行依赖安装、数据库迁移、Docker 或项目测试。

## 命令行协议

`create-hx` 支持以下互斥模式：

```text
create-hx [directory]
create-hx --update [directory]
create-hx --help
create-hx --version
```

`--update` 只允许出现一次，并允许零个或一个目录参数。其他未知选项、多个目录、重复模式或把帮助/版本参数与其他参数混用均返回用法错误和退出码 `1`。

同步完成且无冲突时返回 `0`。已安全应用部分更新但存在需要人工合并的冲突时返回 `2`。下载、校验、文件竞争、回滚或写入失败返回 `1`。`SIGINT` 和 `SIGTERM` 继续返回 `130` 和 `143`。

## 模板锁文件

新项目根目录包含 `.hx-template-lock.json`。该文件必须提交到项目版本控制中，是后续同步判断模板基线的唯一来源。概念结构为：

```json
{
  "schemaVersion": 1,
  "source": {
    "repository": "SamChowRock/Hx",
    "ref": "main"
  },
  "projectName": "my-project",
  "templateDigest": "<sha256>",
  "files": {
    ".env.example": {
      "sha256": "<sha256>",
      "executable": false
    }
  }
}
```

锁文件只记录经过排除、overlay、源码区块删除和 `package.json` 转换后的普通模板文件。它不记录自身、`.hx-update/`、目录、用户新增文件或任何本地绝对路径。

路径按 Unicode 码点排序后写入。`templateDigest` 对稳定序列化后的 `files` 计算 SHA-256，用于摘要显示和完整性验证。解析器拒绝未知字段、非规范相对路径、重复路径、不支持的 schema、错误哈希、非布尔执行位、错误摘要和指向锁文件或冲突目录的路径。

初始化时，CLI 在 staging 中完成模板转换和输出校验，计算文件状态，最后写入锁文件并与脚手架一起提交。锁文件本身不参与模板摘要。

## 项目识别和旧项目接管

有合法锁文件的项目直接进入精确同步模式。项目名来自锁文件，并要求根 `package.json.name` 仍是合法非 scoped npm 名；两者不同只用于提示，不改变锁文件中稳定的模板项目名，以免目录重命名或包名调整影响 README overlay。

没有锁文件时只允许接管 `create-hx@0.1.x` 风格的项目。目标必须是非符号链接目录，并至少包含以下普通文件：

- `package.json`
- `apps/api/src/main.ts`
- `apps/worker/src/main.ts`
- `docker-compose.yml`
- `prisma/schema.prisma`

`package.json.name` 必须是合法项目名。若目标含 `.hx-template/` 或 `packages/create-hx/`，CLI 认为这是 Hx 源仓库并拒绝同步。

首次接管没有可信的历史基线，因此采用保守规则：本地与最新模板相同的文件直接纳入锁；最新模板中的新路径在本地不存在时自动添加；本地已存在但内容不同的路径全部保留，并把最新版本写入冲突保留区。接管完成后写入最新模板锁，后续运行使用精确模式。

## 比较模型

文件身份由内容 SHA-256 和可执行位共同决定。同步计划对“上次模板基线、当前本地文件、最新模板文件”的并集逐路径计算：

1. 基线和最新模板都有文件：
   - 本地等于基线且最新不同：自动替换为最新版本。
   - 本地等于基线且最新相同：不操作。
   - 本地不同于基线且最新等于基线：保留用户修改，不产生冲突。
   - 本地不同于基线且最新也不同：保留本地，复制最新版本到冲突保留区。
   - 本地已删除：视为用户修改；最新未变化时保留删除，最新有变化时产生冲突版本。
2. 基线有文件、最新模板已删除：
   - 本地等于基线：自动删除。
   - 本地已修改：保留本地并报告“模板已删除，本地已修改”，该路径退出模板追踪。
   - 本地也已删除：不操作并退出追踪。
3. 基线没有文件、最新模板新增：
   - 本地不存在：自动添加。
   - 本地与最新相同：直接纳入追踪。
   - 本地已存在且不同：保留本地并产生冲突版本。
4. 不在基线和最新模板中的本地路径是用户文件，始终不读取、不删除、不移动。

无论是否存在冲突，成功应用安全更新后，锁文件都更新为最新模板基线。这样用户把冲突版本合并回原路径后，下次同步可识别其已等于基线；未解决的本地修改仍继续受到保护。

## 冲突保留区

冲突内容写入项目根 `.hx-update/incoming/<原路径>`，并生成 `.hx-update/report.json`，记录操作类别、路径和最新模板摘要。模板已删除但本地已修改的路径只记录在报告中，因为不存在 incoming 内容。

CLI 不覆盖已有非空 `.hx-update/`。如果上次冲突尚未清理，新的同步在下载前失败并要求用户先处理或移动该目录。新生成项目的 `.gitignore` 增加 `/.hx-update/`，旧项目即使本地 `.gitignore` 已修改也不会被强行改写；CLI 输出会明确提醒不要提交冲突保留区。

无冲突时不创建 `.hx-update/`。用户处理完冲突后自行删除该目录。

## 更新事务和竞争保护

同步先在目标同级目录准备完整最新模板、锁文件、更新文件和冲突内容。所有下载、解包、转换、锁校验和计划计算完成前，不写目标项目。

提交前重新读取每个将修改的目标路径，并验证其类型、内容哈希、执行位和 inode 身份仍与计划阶段一致。父目录和项目根也验证 inode 身份。任何变化都中止提交。

提交采用同文件系统原子 rename：

- 替换或删除前，把原文件移动到事务备份目录。
- 新文件和冲突文件从事务 staging 原子移动到目标。
- 锁文件最后替换，作为事务完成标志。
- 目录只按需创建；回滚时只处理本次创建且身份仍匹配的目录。

任一步失败时，CLI 把已写入的新文件移动回私有事务目录，再把备份文件恢复。若目标路径已被并发替换，CLI 不删除该路径，而把备份保存在目标同级的 `.create-hx-preserved-<uuid>` 并报告。CLI 不递归删除用户路径。

中断信号使用相同回滚流程。临时下载、模板 staging 和已成功回滚的备份目录在结束时清理。

## 模块边界

新增模块：

- `src/template-state.js`：扫描 staging、计算稳定哈希、验证和序列化锁文件。
- `src/update-plan.js`：纯函数比较基线、本地状态和最新状态，输出添加、替换、删除、保留和冲突计划。
- `src/update-target.js`：识别项目、收集受控本地状态、准备冲突区并事务性提交/回滚。

调整模块：

- `src/arguments.js`：解析 `--update`。
- `src/scaffold.js`：提取可复用的“下载并生成模板 staging”流程；初始化时写锁。
- `src/cli.js`：分派创建或同步模式，打印摘要并映射冲突退出码。
- `.gitignore`：忽略 `/.hx-update/`。
- `packages/create-hx/README.md`：记录同步命令、锁文件和冲突处理。
- `packages/create-hx/package.json`：升级到 `0.2.0`，把 bin 路径规范为 `bin/create-hx.js`。

现有 `target.js` 的空目录初始化事务保持独立，不扩展成非空目录同步逻辑。

## 输出

无冲突示例：

```text
Hx scaffold updated at /path/to/project.

Updated: 6
Added: 2
Deleted: 1
Preserved: 4
Conflicts: 0
```

有冲突时额外输出：

```text
Review incoming files in .hx-update/incoming and .hx-update/report.json.
Merge the changes you want, then remove .hx-update.
```

更新命令只打印结果和人工处理说明，不运行安装或项目测试。

## 测试策略

所有行为使用 Node 内置测试运行器和真实临时文件系统，继续使用本地 HTTPS tarball fixture：

- 参数解析、帮助和冲突退出码。
- 锁文件稳定序列化、哈希、执行位和严格 schema 校验。
- 新建项目写入合法锁文件且 `.hx-update/` 被忽略。
- 未修改文件的添加、更新、删除和执行位更新。
- 用户修改、用户删除、用户新增和模板删除后的保留行为。
- 冲突 incoming、报告、已有冲突目录拒绝。
- 旧 `0.1.x` 项目保守接管和非 Hx 目录拒绝。
- 下载、manifest、transform 或计划失败时目标零写入。
- 提交中途失败、并发替换和信号中断后的回滚。
- 本地仓库 fixture 连续生成两个模板版本并验证端到端同步。
- npm 包内容仍只包含 bin、runtime source、README 和 npm 必需 metadata。

根 Hx 测试、格式、lint、typecheck、教程检查和 Docker Compose 配置必须继续通过。

## 发布

该功能改变公共 CLI 协议并新增项目锁文件，`create-hx` 次版本升级为 `0.2.0`。代码合并后使用独立标签 `create-hx-v0.2.0` 触发发布工作流。首次发布 `0.1.0` 使用的临时 token 不再使用；后续发布应先把 npm Trusted Publisher 绑定到 `SamChowRock/Hx` 的 `publish-create-hx.yml`。

## 验收标准

1. `pnpm create hx --update [directory]` 可以同步最新 Hx `main`。
2. 用户未修改的模板文件自动添加、更新或删除。
3. 用户文件和用户修改绝不被静默覆盖或删除。
4. 同路径双向修改产生可审查 incoming 文件和退出码 `2`。
5. 新项目带合法锁文件，旧 `0.1.x` 项目可以保守接管。
6. 更新提交失败或中断时恢复原项目；并发替换不被删除。
7. 更新不复制文档、教程、`.hx-template/` 或 `packages/create-hx/`。
8. CLI、根项目和打包检查全部通过。
