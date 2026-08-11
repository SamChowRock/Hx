# NestJS Production Scaffold

Milestone 0 provides a strict TypeScript NestJS API and Worker foundation with validated configuration, JSON logs, OpenAPI, health endpoints, Docker-based local dependencies, CI, and a non-root production image.

The project decisions that guide this scaffold are in `docs/REFERENCE_PRODUCT.md`, `docs/API_CONVENTIONS.md`, `docs/THREAT_MODEL.md`, and `docs/adr/`. Milestone 0 acceptance evidence is recorded in `docs/MILESTONE_0_ACCEPTANCE.md`.

## Prerequisites

- Node.js 24.19.0 (see `.nvmrc`)
- pnpm 11.21.0
- Docker Desktop, or Docker CLI + Compose with Colima on macOS

## Start locally

If you use Colima, start its Docker runtime first with `colima start`.

```bash
cp .env.example .env
pnpm install
docker compose up --build -d
```

Open `http://localhost:3000/docs` for OpenAPI and use these endpoints:

- `GET /api/health/live`
- `GET /api/health/ready`

`docker compose ps` shows the API, Worker, PostgreSQL, both Redis services, MinIO, and Mailpit. Use `docker compose logs -f api worker` to follow application logs and `docker compose down` to stop the stack.

For host-based hot reload, start only the dependencies and then run the API and Worker in separate terminals:

```bash
docker compose up -d postgres redis-cache redis-queue minio mailpit
pnpm dev:api
pnpm dev:worker
```

## Verification

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose config --quiet
docker build --tag nestjs-production-scaffold:local .
```

## Git hook

This workspace uses Husky for pre-commit formatting, linting, and type checks. `pnpm install` runs the `prepare` script and enables `.husky/pre-commit` in a Git repository. If Git is initialized after dependencies are installed, run `pnpm exec husky` once to enable the hook.

## Local service ports

| Service             | Address                                    |
| ------------------- | ------------------------------------------ |
| PostgreSQL          | `localhost:5432`                           |
| Cache Redis         | `localhost:6379`                           |
| BullMQ Redis        | `localhost:6380`                           |
| MinIO API / console | `localhost:9000` / `http://localhost:9001` |
| Mailpit SMTP / UI   | `localhost:1025` / `http://localhost:8025` |

The Worker starts as a separate container but does not process jobs yet. Prisma, BullMQ processors, object-storage integration, authentication, and domain modules are introduced in later milestones.

---

# NestJS 生产级脚手架（中文版）

Milestone 0 提供一套严格的 TypeScript NestJS API 与 Worker 基础设施，包括配置校验、JSON 日志、OpenAPI、健康检查端点、基于 Docker 的本地依赖、CI，以及使用非 root 用户运行的生产镜像。

指导本脚手架的项目决策记录在 `docs/REFERENCE_PRODUCT.md`、`docs/API_CONVENTIONS.md`、`docs/THREAT_MODEL.md` 和 `docs/adr/` 中。Milestone 0 的验收证据记录在 `docs/MILESTONE_0_ACCEPTANCE.md` 中。

## 前置要求

- Node.js 24.19.0（参见 `.nvmrc`）
- pnpm 11.21.0
- Docker Desktop，或者在 macOS 上使用 Docker CLI + Compose + Colima

## 本地启动

如果使用 Colima，请先运行 `colima start` 启动 Docker Runtime。

```bash
cp .env.example .env
pnpm install
docker compose up --build -d
```

打开 `http://localhost:3000/docs` 查看 OpenAPI，并可使用以下端点：

- `GET /api/health/live`
- `GET /api/health/ready`

`docker compose ps` 会显示 API、Worker、PostgreSQL、两个 Redis 服务、MinIO 和 Mailpit。使用 `docker compose logs -f api worker` 跟踪应用日志，使用 `docker compose down` 停止整套环境。

如需在 Host 上使用 Hot Reload，只启动依赖服务，然后分别在两个终端中运行 API 和 Worker：

```bash
docker compose up -d postgres redis-cache redis-queue minio mailpit
pnpm dev:api
pnpm dev:worker
```

## 验证

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose config --quiet
docker build --tag nestjs-production-scaffold:local .
```

## Git Hook

本工作区使用 Husky 在提交前执行格式检查、Lint 和类型检查。`pnpm install` 会运行 `prepare` 脚本，并在 Git 仓库中启用 `.husky/pre-commit`。如果在安装依赖之后才初始化 Git，请运行一次 `pnpm exec husky` 来启用 Hook。

## 本地服务端口

| 服务                | 地址                                       |
| ------------------- | ------------------------------------------ |
| PostgreSQL          | `localhost:5432`                           |
| 缓存 Redis          | `localhost:6379`                           |
| BullMQ Redis        | `localhost:6380`                           |
| MinIO API / 控制台  | `localhost:9000` / `http://localhost:9001` |
| Mailpit SMTP / 界面 | `localhost:1025` / `http://localhost:8025` |

Worker 会作为独立容器启动，但目前还不处理任务。Prisma、BullMQ Processor、对象存储集成、认证和领域模块将在后续里程碑中引入。
