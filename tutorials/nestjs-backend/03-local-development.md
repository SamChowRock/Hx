# 3. 搭建本地开发环境

> [返回教程首页](README.md)

## 3.1 版本要求

仓库声明的版本是：

- Node.js `24.19.0`，见 `.nvmrc`；
- pnpm `11.21.0`，见 `package.json#packageManager`；
- Docker Desktop，或 macOS 上的 Docker CLI + Compose + Colima。

先检查：

```bash
node --version
pnpm --version
docker --version
docker compose version
```

如果 Node 不是 24.19.0，pnpm 会输出 `Unsupported engine`。有时编译仍能成功，但原生依赖、运行时 API 或 CI 可能表现不同，所以不要长期忽略。使用 nvm 时：

```bash
nvm install
nvm use
corepack enable
```

## 3.2 第一次启动：全部运行在容器里

```bash
cp .env.example .env
pnpm install
docker compose up --build -d
```

Compose 的启动依赖是：

```text
PostgreSQL healthy
    ↓
Migration 执行成功
    ↓
API 与 Worker 启动
```

检查状态：

```bash
docker compose ps
docker compose logs -f api worker
```

打开：

- Swagger/OpenAPI：`http://localhost:3000/docs`
- 存活检查：`http://localhost:3000/api/health/live`
- 就绪检查：`http://localhost:3000/api/health/ready`
- Mailpit：`http://localhost:8025`
- MinIO Console：`http://localhost:9001`

验证健康接口：

```bash
curl -i http://localhost:3000/api/health/live
curl -i http://localhost:3000/api/health/ready
```

## 3.3 日常开发：依赖放容器，代码在 Host 热更新

这是最推荐的研发方式：

```bash
docker compose up -d postgres redis-cache redis-queue minio mailpit
pnpm prisma:migrate:deploy
pnpm dev:api
```

再开一个终端：

```bash
pnpm dev:worker
```

`dev:api` 和 `dev:worker` 使用 `tsx watch`，修改 TypeScript 后自动重启。这里不要同时启动 Compose 里的 `api`、`worker`，否则会出现端口冲突，或两个 Worker 同时消费 Outbox。

Profile 头像功能依赖 `minio`；不要在只启动 PostgreSQL 的情况下测试上传。开发环境默认会使用 `user-content` Bucket，并可由服务自动创建。打开 `http://localhost:9001` 可以观察对象，但不要手工删除仍被 `users.avatar_object_key` 引用的对象。

## 3.4 本地服务端口

| 服务          | 地址/端口        | 用途                      |
| ------------- | ---------------- | ------------------------- |
| API           | `localhost:3000` | NestJS HTTP API           |
| PostgreSQL    | `localhost:5432` | 业务数据、Session、Outbox |
| Cache Redis   | `localhost:6379` | 后续缓存，允许淘汰        |
| Queue Redis   | `localhost:6380` | 后续 BullMQ，禁止淘汰     |
| MinIO API     | `localhost:9000` | S3 兼容对象存储           |
| MinIO Console | `localhost:9001` | 对象存储管理界面          |
| Mailpit SMTP  | `localhost:1025` | 接收本地邮件              |
| Mailpit UI    | `localhost:8025` | 查看邮件                  |

## 3.5 停止与重置

停止但保留数据：

```bash
docker compose down
```

下面的命令会删除 PostgreSQL、Redis Queue 和 MinIO 的本地卷，**所有本地数据都会清空**：

```bash
docker compose down -v
```

只在你明确想重建本地环境时使用它。

## 3.6 第一个实验：确认 API、数据库和 Worker 各自工作

不要只看 `docker compose ps` 的 Up 状态。依次完成三个验证。

### 验证 API 进程

```bash
curl -sS http://localhost:3000/api/health/live
```

预期类似：

```json
{ "status": "ok", "service": "nestjs-production-scaffold-api" }
```

这只能证明 Node/Nest 进程能响应。

### 验证数据库链路

```bash
curl -sS http://localhost:3000/api/health/ready
```

`ready()` 内部执行 `SELECT 1`。如果 live 成功而 ready 返回 503，问题通常在 PostgreSQL、`DATABASE_URL`、网络或 Migration，而不是 Controller 路由。

### 验证 Worker 链路

先查看日志：

```bash
docker compose logs --tail=50 worker
```

应看到：

```text
Worker ready
Worker started; transactional outbox processing is active
```

完成一次邮箱注册请求后，再观察 Worker 与 Mailpit：

```bash
curl -i \
  -H 'Origin: http://localhost:5173' \
  -H 'Content-Type: application/json' \
  -d '{"email":"student@example.test"}' \
  http://localhost:3000/api/auth/registrations/email
```

预期 HTTP 202。随后打开 Mailpit，应看到主题为 `Verify your account` 的邮件。这同时证明了：

```text
Controller → IdentityService → PostgreSQL Transaction
→ OutboxEvent → Worker → SMTP → Mailpit
```

如果 API 返回 202 但 Mailpit 没有邮件，先查 Outbox 和 Worker，而不是反复点前端按钮。

## 3.7 直接观察 PostgreSQL 中的数据

### 方式一：Prisma Studio（最适合先观察业务数据）

如果你不想先学习 `psql`，使用 Prisma Studio 是最快的入口：它会把当前 Prisma Schema 中的 Model 显示成可筛选、可展开关联的表格界面。

```bash
pnpm exec prisma studio
```

浏览器会打开 `http://localhost:5555`。优先观察这些表与一次请求之间的关系：

- `registration_intents`：邮箱注册请求尚未验证时的短期意图；
- `users`、`organizations`、`memberships`：注册成功后创建的用户和默认租户；
- `sessions`：浏览器登录会话；
- `external_identities`、`oauth_profile_transactions`：OIDC/微信等外部身份与登录回调事务；
- `outbox_events`：事务内写入、由 Worker 异步投递的事件。

Studio 可以编辑和删除数据，但它会绕过 Controller、Service、权限、审计和业务不变量。只把它用于本地开发数据；不要连接生产数据库，也不要用它“修复”状态异常。

### 方式二：数据库 GUI（适合写 SQL 和看执行计划）

当你需要执行任意 SQL、查看 Index、分析锁或运行 `EXPLAIN ANALYZE` 时，安装 DBeaver（免费、跨平台）或 TablePlus（macOS 体验较好）会比 Prisma Studio 更合适。先确保 Compose 中的 `postgres` 已启动，再新建 PostgreSQL 连接：

| 字段     | 当前本地开发值 |
| -------- | -------------- |
| Host     | `localhost`    |
| Port     | `5432`         |
| Database | `scaffold`     |
| User     | `scaffold`     |
| Password | `scaffold`     |
| Schema   | `public`       |
| SSL      | 关闭           |

连接串也可以直接粘贴：

```text
postgresql://scaffold:scaffold@localhost:5432/scaffold?schema=public
```

这些是 Compose 为本地开发提供的公开凭据，不可复用到生产环境。连接成功后，在 `public` Schema 下展开 Tables；使用 SQL Console 执行只读查询或 `EXPLAIN (ANALYZE, BUFFERS)`。前端开发中常见的浏览器 Network 面板，到了数据库层就对应这里的 Query History、执行计划和锁等待视图。

### 方式三：容器内 `psql`（适合学习 PostgreSQL 本身）

进入容器内的 `psql`：

```bash
docker compose exec postgres psql -U scaffold -d scaffold
```

常用只读命令：

```sql
\dt
\d users
\d outbox_events

SELECT id, type, status, attempts, available_at, created_at
FROM outbox_events
ORDER BY created_at DESC
LIMIT 10;

SELECT id, normalized_email, status, expires_at
FROM registration_intents
ORDER BY created_at DESC
LIMIT 10;
```

退出：

```sql
\q
```

观察数据的学习重点不是记住 psql 命令，而是把代码行为对应到数据库状态：注册请求为什么先有 Intent 和 Outbox、什么时候才出现 User、Worker 成功后为什么 Payload 被脱敏。

不要在不了解后果时直接 `UPDATE` 或 `DELETE` 这些表。手工改状态会绕过业务不变量和审计。

---
