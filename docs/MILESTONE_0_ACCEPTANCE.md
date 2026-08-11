# Milestone 0 Acceptance

Status: complete as of 2026-08-11.

This record maps the Foundation milestone in `BACKEND_SCAFFOLD_BLUEPRINT.md` to reproducible evidence. It verifies the scaffold boundary; it does not claim that later database, queue-processing, authentication, or product modules already exist.

## Acceptance checklist

| Requirement                        | Evidence                                                                                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pinned runtime and package manager | `.nvmrc` pins Node.js 24.19.0; `package.json` pins pnpm 11.21.0 and matching engine ranges.                                                                                       |
| Strict TypeScript and code quality | Strict `tsconfig.json`, ESLint, Prettier, and a Husky pre-commit hook are configured.                                                                                             |
| Reproducible dependencies          | `pnpm-lock.yaml` is committed; pnpm 11 build-script permissions are explicit in `pnpm-workspace.yaml`; Dependabot checks npm dependencies weekly.                                 |
| Configuration validation           | Zod validates environment variables at process startup; `.env.example` contains safe development values.                                                                          |
| API foundation                     | The API uses Pino JSON logs, OpenAPI at `/docs`, CORS configuration, shutdown hooks, and live/readiness endpoints.                                                                |
| Worker foundation                  | A separate NestJS application context starts and stays active until graceful shutdown. Queue processors are deliberately deferred.                                                |
| Container image                    | The multi-stage Node 24 Alpine image installs from the frozen lockfile, builds TypeScript, prunes development dependencies, and runs as the non-root `app` user.                  |
| Local stack                        | Docker Compose starts API, Worker, PostgreSQL, cache Redis, no-eviction queue Redis, MinIO, and Mailpit. API, PostgreSQL, and both Redis services have health checks.             |
| Continuous integration             | GitHub Actions installs from the frozen lockfile; runs formatting, lint, types, tests, and build; validates Compose; builds the image; and smoke-tests API and Worker containers. |
| Architecture documentation         | Reference-product constraints, API conventions, threat model, ADRs, and the backend blueprint exist in English and Chinese.                                                       |

## Verified commands and outcomes

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose config --quiet
docker build --tag nestjs-production-scaffold:local .
docker compose up --build --detach
curl --fail http://127.0.0.1:3000/api/health/live
curl --fail http://127.0.0.1:3000/api/health/ready
curl --fail http://127.0.0.1:3000/docs
docker compose ps --all
```

Observed acceptance results:

- Formatting, linting, TypeScript checking, and build passed under Node.js 24.19.0 and pnpm 11.21.0.
- Three Jest suites passed with five tests.
- The production image built successfully, was approximately 66 MB at acceptance time, and declared `USER app` (`uid=100`) for both process types.
- The API remained healthy and returned HTTP 200 from liveness, readiness, and OpenAPI routes.
- The Worker remained running as a separate non-root container.
- PostgreSQL, cache Redis, and queue Redis reported healthy; MinIO and Mailpit remained running.

## Deliberately deferred

- Readiness currently covers the process and validated configuration. Dependency-specific readiness checks are added when database, queue, and object-storage clients are introduced.
- The Worker contains a temporary keep-alive handle because no BullMQ consumers exist yet. Milestone 3 removes it when real consumers keep the event loop active.
- Prisma/database access, BullMQ processors, transactional outbox, object-storage integration, authentication, tenant modules, and production deployment belong to later milestones.

---

# Milestone 0 验收记录（中文版）

状态：截至 2026-08-11 已完成。

本记录将 `BACKEND_SCAFFOLD_BLUEPRINT.md` 中的基础里程碑映射为可重复执行的验收证据。它验证脚手架边界，但不表示后续数据库、队列处理、认证或产品模块已经存在。

## 验收清单

| 要求                       | 证据                                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 固定 Runtime 与包管理器    | `.nvmrc` 固定 Node.js 24.19.0；`package.json` 固定 pnpm 11.21.0 和对应 Engine Range。                                                           |
| 严格 TypeScript 与代码质量 | 已配置严格 `tsconfig.json`、ESLint、Prettier 和 Husky Pre-commit Hook。                                                                         |
| 可重复安装的依赖           | 已提交 `pnpm-lock.yaml`；`pnpm-workspace.yaml` 显式设置 pnpm 11 Build Script 权限；Dependabot 每周检查 npm 依赖。                               |
| 配置校验                   | Zod 在进程启动时校验环境变量；`.env.example` 包含安全的开发示例值。                                                                             |
| API 基础                   | API 使用 Pino JSON 日志、`/docs` OpenAPI、CORS 配置、Shutdown Hook 和 Live/Readiness Endpoint。                                                 |
| Worker 基础                | 独立 NestJS Application Context 启动并持续运行，直到 Graceful Shutdown。Queue Processor 有意延后。                                              |
| 容器镜像                   | 多阶段 Node 24 Alpine 镜像根据 Frozen Lockfile 安装、构建 TypeScript、裁剪开发依赖，并以非 root `app` 用户运行。                                |
| 本地 Stack                 | Docker Compose 启动 API、Worker、PostgreSQL、缓存 Redis、No-eviction Queue Redis、MinIO 和 Mailpit。API、PostgreSQL 与两个 Redis 都有健康检查。 |
| 持续集成                   | GitHub Actions 根据 Frozen Lockfile 安装；运行格式、Lint、类型、测试和构建；校验 Compose；构建镜像；并 Smoke Test API 与 Worker 容器。          |
| 架构文档                   | 参考产品约束、API 约定、威胁模型、ADR 和后端蓝图都提供英文与中文版本。                                                                          |

## 已验证命令与结果

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose config --quiet
docker build --tag nestjs-production-scaffold:local .
docker compose up --build --detach
curl --fail http://127.0.0.1:3000/api/health/live
curl --fail http://127.0.0.1:3000/api/health/ready
curl --fail http://127.0.0.1:3000/docs
docker compose ps --all
```

验收时观察到的结果：

- 在 Node.js 24.19.0 和 pnpm 11.21.0 下，格式、Lint、TypeScript 检查和构建通过。
- 3 个 Jest Suite、共 5 个测试全部通过。
- 生产镜像构建成功，验收时约 66 MB，并为两种进程类型声明 `USER app`（`uid=100`）。
- API 保持 Healthy，Liveness、Readiness 和 OpenAPI 路由均返回 HTTP 200。
- Worker 作为独立的非 root 容器持续运行。
- PostgreSQL、缓存 Redis 和队列 Redis 报告 Healthy；MinIO 和 Mailpit 持续运行。

## 有意延后的内容

- Readiness 当前覆盖进程和已验证配置。引入数据库、队列和对象存储 Client 时，再添加针对这些依赖的 Readiness Check。
- Worker 当前包含临时 Keep-alive Handle，因为尚无 BullMQ Consumer。Milestone 3 中真实 Consumer 可以保持 Event Loop 活跃后将其移除。
- Prisma/数据库访问、BullMQ Processor、Transactional Outbox、对象存储集成、认证、租户模块和生产部署属于后续里程碑。
