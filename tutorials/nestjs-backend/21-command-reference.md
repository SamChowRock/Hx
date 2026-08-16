# 21. 命令速查表

> [返回教程首页](README.md)

## 开发

```bash
pnpm install
pnpm dev:api
pnpm dev:worker
```

## 基础设施

```bash
docker compose up -d postgres redis-cache redis-queue minio mailpit
docker compose ps
docker compose logs -f api worker
docker compose down
```

## Prisma

```bash
pnpm prisma:generate
pnpm exec prisma migrate dev --name <migration_name>
pnpm prisma:migrate:deploy
pnpm exec prisma migrate status

# 启动 Prisma 的本地数据浏览器（默认 http://localhost:5555）
pnpm exec prisma studio
```

## 质量检查

```bash
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:watch
pnpm test:e2e
pnpm build
```

## 教程维护

```bash
# 查看当前代码变更可能影响哪些教程
pnpm tutorial:impact

# 重新生成命令、环境变量、Compose、Prisma 和 API 事实页
pnpm tutorial:generate

# 检查生成内容漂移与本地链接
pnpm tutorial:check

# 在 CI/PR 中强制要求受影响教程经过审查
pnpm tutorial:impact:check --base origin/main --head HEAD
```

完整规则和豁免方式见[教程维护机制](maintenance/README.md)。

## 容器验证

```bash
docker compose config --quiet
docker compose build migration api worker
docker compose up --detach --wait postgres
```

## 服务入口

```text
Swagger:        http://localhost:3000/docs
Liveness:       http://localhost:3000/api/health/live
Readiness:      http://localhost:3000/api/health/ready
Mailpit:        http://localhost:8025
MinIO Console:  http://localhost:9001
```

---
