# NestJS Production Scaffold

This repository is a production-oriented NestJS modular-monolith scaffold. It now includes the Milestone 0 platform foundation plus the core Milestone 1 identity, tenancy, and authorization path: PostgreSQL migrations, verified email and E.164 phone registration, password, OIDC, and WeChat website QR sign-in, opaque server sessions, CSRF/origin defenses, user profiles with concurrency-safe nickname quotas and private processed avatars, organizations and memberships, tenant-scoped projects, audit events, and transactional email/SMS delivery through the Worker.

The project decisions that guide this scaffold are in `docs/REFERENCE_PRODUCT.md`, `docs/API_CONVENTIONS.md`, `docs/THREAT_MODEL.md`, and `docs/adr/`. Milestone 0 acceptance evidence is recorded in `docs/MILESTONE_0_ACCEPTANCE.md`.

The standalone learning path is in [`tutorials/nestjs-backend/`](tutorials/nestjs-backend/README.md). Its generated project facts and CI drift checks keep code examples aligned with the repository.

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
- `GET /api/profile`
- `PATCH /api/profile`
- `PATCH /api/profile/visibility`
- `PUT /api/profile/avatar`
- `GET /api/profiles/:userId`

Email messages appear in Mailpit at `http://localhost:8025`. Phone registration is disabled by default; set `SMS_PROVIDER=twilio` and all three `TWILIO_*` values in `.env` to enable real SMS delivery. The API always commits delivery requests to PostgreSQL first, and the Worker claims them with bounded retries.

Profile access is session-bound. Active users may read another Active user's allowlisted shared profile, while the target independently opts their biography, avatar, verified primary email, and verified primary phone into `AUTHENTICATED` visibility; all default to `PRIVATE`. Profile and visibility writes always target the authenticated user's own account. Nicknames contain at most 16 Unicode code points and can be changed at most three times per rolling 30 days. Avatars use the private `user-content` bucket in local MinIO; the API validates and re-encodes uploads before storage. See `docs/USER_PROFILE_MODULE.md` for the authorization, privacy, API, nickname, and avatar contracts.

WeChat login is disabled by default. After a WeChat Open Platform website application and its callback domain are approved, set `WECHAT_PROVIDER_KEY=wechat`, `WECHAT_APP_ID`, and `WECHAT_APP_SECRET`. Register `<API_PUBLIC_ORIGIN>/api/auth/external/wechat/callback` as the callback URL (for example, `https://api.example.com/api/auth/external/wechat/callback`; use the actual configured provider key). The integration is website QR login, not Official Account or Mini Program login; see ADR 0004 for identity and security boundaries.

`docker compose ps` shows the API, Worker, PostgreSQL, both Redis services, MinIO, and Mailpit. Use `docker compose logs -f api worker` to follow application logs and `docker compose down` to stop the stack.

For host-based hot reload, start only the dependencies and then run the API and Worker in separate terminals:

```bash
docker compose up -d postgres redis-cache redis-queue minio mailpit
pnpm prisma:migrate:deploy
pnpm dev:api
pnpm dev:worker
```

## Verification

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm tutorial:check
pnpm build
docker compose config --quiet
docker compose build migration api worker
docker compose up --detach --wait postgres
pnpm prisma:migrate:deploy
pnpm test:e2e
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

The current Worker processes PostgreSQL transactional-outbox email and SMS events. BullMQ generalization, the object-storage quarantine pipeline, provider-specific account linking/contact management, and production deployment automation remain later roadmap work.

---

# NestJS 生产级脚手架（中文版）

本仓库是一套面向生产环境的 NestJS 模块化单体脚手架。目前已包含 Milestone 0 平台基础，以及 Milestone 1 的核心身份、租户和授权链路：PostgreSQL Migration、经过验证的邮箱和 E.164 手机号注册、密码、OIDC 与微信网站扫码登录、不透明服务端 Session、CSRF/Origin 防护、具有并发安全昵称配额与私有处理头像的用户 Profile、Organization 与 Membership、租户范围 Project、Audit Event，以及由 Worker 通过事务 Outbox 完成的邮件/SMS 投递。

指导本脚手架的项目决策记录在 `docs/REFERENCE_PRODUCT.md`、`docs/API_CONVENTIONS.md`、`docs/THREAT_MODEL.md` 和 `docs/adr/` 中。Milestone 0 的验收证据记录在 `docs/MILESTONE_0_ACCEPTANCE.md` 中。

独立学习教程位于 [`tutorials/nestjs-backend/`](tutorials/nestjs-backend/README.md)，其中的项目事实快照和 CI 漂移检查用于保持教程与仓库代码同步。

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
- `GET /api/profile`
- `PATCH /api/profile`
- `PATCH /api/profile/visibility`
- `PUT /api/profile/avatar`
- `GET /api/profiles/:userId`

邮件可在 Mailpit 的 `http://localhost:8025` 中查看。手机注册默认关闭；在 `.env` 中设置 `SMS_PROVIDER=twilio` 以及三个完整的 `TWILIO_*` 配置后，才会启用真实 SMS 投递。API 总是先把投递请求提交到 PostgreSQL，再由 Worker 领取并执行有限次数重试。

Profile 访问绑定 Session。Active 用户可以读取其他 Active 用户经过 Allowlist 的共享资料；目标用户可以分别把简介、头像、已验证 Primary 邮箱和已验证 Primary 手机号设为 `AUTHENTICATED`，所有设置默认均为 `PRIVATE`。资料和可见性写操作始终只能作用于当前登录用户本人。昵称最长 16 个 Unicode Code Point，在任意滚动 30 天内最多修改三次。头像在本地使用 MinIO 中的私有 `user-content` Bucket；API 会在存储前校验并重新编码头像。权限、隐私、API、昵称与头像契约见 `docs/USER_PROFILE_MODULE.md`。

微信登录默认关闭。微信开放平台网站应用及其回调域名审核通过后，设置 `WECHAT_PROVIDER_KEY=wechat`、`WECHAT_APP_ID` 和 `WECHAT_APP_SECRET`。在微信开放平台登记 `<API_PUBLIC_ORIGIN>/api/auth/external/wechat/callback` 作为回调地址（例如 `https://api.example.com/api/auth/external/wechat/callback`；路径中的 Provider Key 应与实际配置一致）。本集成是网站扫码登录，不是公众号或小程序登录；身份与安全边界见 ADR 0004。

`docker compose ps` 会显示 API、Worker、PostgreSQL、两个 Redis 服务、MinIO 和 Mailpit。使用 `docker compose logs -f api worker` 跟踪应用日志，使用 `docker compose down` 停止整套环境。

如需在 Host 上使用 Hot Reload，只启动依赖服务，然后分别在两个终端中运行 API 和 Worker：

```bash
docker compose up -d postgres redis-cache redis-queue minio mailpit
pnpm prisma:migrate:deploy
pnpm dev:api
pnpm dev:worker
```

## 验证

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm tutorial:check
pnpm build
docker compose config --quiet
docker compose build migration api worker
docker compose up --detach --wait postgres
pnpm prisma:migrate:deploy
pnpm test:e2e
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

当前 Worker 会处理 PostgreSQL 事务 Outbox 中的邮件和 SMS Event。BullMQ 通用化、对象存储隔离扫描流程、Provider 特定的账号绑定/联系方式管理，以及生产部署自动化仍属于后续路线图。
