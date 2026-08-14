# 教程维护机制

> [返回教程首页](../README.md) · [查看自动生成的项目事实](../generated/README.md)

本目录用于防止教程随着代码迭代逐渐失真。它不尝试自动重写设计解释，而是把教程内容分成三类：

| 内容类型           | 维护方式                             | 例子                                                    |
| ------------------ | ------------------------------------ | ------------------------------------------------------- |
| 可从代码确定的事实 | 自动生成并做精确漂移检查             | scripts、环境变量、Compose 服务、Prisma Model、API 路由 |
| 可以执行的行为     | 由现有测试、E2E、构建和 Compose 验证 | API 契约、Migration、容器启动                           |
| 设计原因与工程判断 | 影响检查定位后，由研发或 AI 语义审查 | 事务边界、认证信任边界、迁移策略                        |

## 日常更新流程

代码修改后执行：

```bash
pnpm tutorial:impact
pnpm tutorial:generate
pnpm tutorial:check
```

完整流程是：

1. `tutorial:impact` 根据本地 Git 变更和 `impact-map.json` 列出受影响章节；
2. `tutorial:generate` 从当前源码重新生成事实页；
3. 阅读生成差异，确认代码事实变化合理；
4. 审查并更新受影响的人工教程；
5. 如果确认无需修改教程，在 `review-acknowledgements.md` 记录原因；
6. `tutorial:check` 确认生成内容没有漂移且所有本地 Markdown 链接有效；
7. 继续运行仓库的格式、Lint、类型、单测和 E2E 检查。

## 命令

| 命令                         | 作用                           | 是否修改文件 |
| ---------------------------- | ------------------------------ | ------------ |
| `pnpm tutorial:generate`     | 更新 `generated/` 中的事实快照 | 是           |
| `pnpm tutorial:drift`        | 检查事实快照是否与代码一致     | 否           |
| `pnpm tutorial:links`        | 检查教程中的本地 Markdown 链接 | 否           |
| `pnpm tutorial:check`        | 同时执行漂移与链接检查         | 否           |
| `pnpm tutorial:impact`       | 报告本地变更影响的章节         | 否           |
| `pnpm tutorial:impact:check` | 缺少语义审查记录时返回失败     | 否           |

检查指定提交范围：

```bash
pnpm tutorial:impact --base origin/main --head HEAD
pnpm tutorial:impact:check --base origin/main --head HEAD
```

## 影响映射如何工作

`impact-map.json` 中每条规则包含：

- `sources`：会触发规则的源码 Glob；
- `reviewPaths`：可以证明相应教程已经审查的文件；
- `description`：为什么这类变更可能影响教程。

CI 的判断是“是否发生过审查”，不是“教程语义一定正确”。只要修改了一个相关章节，规则便视为已审查；Reviewer 仍需使用[审查清单](review-checklist.md)判断其他候选章节是否也应更新。

新增业务模块、基础设施或教程章节时，应同步更新 `impact-map.json`。不要用宽泛的全仓库规则替代领域映射，否则每次变更都会制造无意义告警。

## 自动生成内容的边界

生成器目前读取：

- `package.json`；
- `.env.example` 与运行时 Zod 环境变量 Schema；
- `docker-compose.yml` 与 `Dockerfile`；
- `prisma/schema.prisma` 与 migration 目录；
- NestJS Module、Controller 和 HTTP Method Decorator。

生成器会强制 `.env.example` 和环境变量 Schema 的字段集合一致。API 路由采用静态提取，不能替代运行时 OpenAPI 和 E2E；Compose 只生成声明事实，不能证明服务真的健康。

## 修改生成器时

1. 修改 `scripts/tutorial/`；
2. 运行两次 `pnpm tutorial:generate`；第二次必须全部显示 `unchanged`；
3. 运行 `pnpm format`；
4. 再运行 `pnpm tutorial:check`，确保格式化不会造成生成漂移；
5. 做一次正向和一次反向验证，例如临时改变源码事实后确认 `tutorial:drift` 失败，再恢复；
6. 运行仓库完整质量检查。
