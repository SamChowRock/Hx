# Compose：服务发现、网络、端口、Volume 与健康检查

> [返回本模块目录](README.md)

## 1. Compose 是本地多服务编排描述

它声明 Service、Network、Volume、Environment、Dependency 和 Healthcheck。它不是生产级调度器，但适合可重复本地环境和 CI Smoke Test。

## 2. Service 与 Container

`postgres` 是 Service 名。Compose 创建实际 Container，并在默认网络提供 DNS：

```text
postgres → PostgreSQL Container IP
mailpit  → Mailpit Container IP
```

所以 API Container 使用：

```text
postgresql://scaffold:scaffold@postgres:5432/scaffold
smtp://mailpit:1025
```

Host 上运行 API 使用 `localhost:5432`、`localhost:1025`。这是最常见配置混淆。

## 3. Network

默认情况下，同一 Compose Project 的 Service 在一个 Bridge Network。Container IP 可变，使用 Service DNS Name，不写死 IP。

```bash
docker compose exec api getent hosts postgres
```

生产中还应按信任边界限制网络，不让每个 Container 随意访问所有 Service/互联网。

## 4. Port Publish

```yaml
ports:
  - '5432:5432'
```

把 Host 5432 转发到 Container 5432。Container 间不需要 Publish。生产数据库通常不应公开到互联网；通过私有网络和受控管理入口访问。

端口冲突：Host 已有 PostgreSQL 时，Compose 无法绑定 5432。可以停旧服务或改 Host Port，例如 `15432:5432`，同时更新 Host `DATABASE_URL`。

## 5. Named Volume

```yaml
volumes:
  postgres-data:
```

引用：

```yaml
postgres:
  volumes:
    - postgres-data:/var/lib/postgresql/data
```

Named Volume 生命周期独立于 Container：

- `docker compose down` 保留；
- `docker compose down -v` 删除；
- 重建 PostgreSQL Container 仍使用原数据；
- Volume 不是自动备份；Host/磁盘损坏仍可丢。

## 6. Bind Mount 与 Named Volume

- Bind Mount：Host 路径映射，适合源码热更新/显式文件；权限和平台差异明显；
- Named Volume：Docker 管理位置，适合数据库本地持久数据；
- tmpfs：只在内存，Container 停止即丢，适合临时数据。

数据库在 macOS Bind Mount 可能受文件系统性能/权限影响，Named Volume 通常更合适。

## 7. `depends_on` 不等于 Ready

只控制启动顺序时，PostgreSQL Process 可能已启动但尚未接受连接。当前使用：

```yaml
depends_on:
  postgres:
    condition: service_healthy
```

并定义：

```yaml
healthcheck:
  test: ['CMD-SHELL', 'pg_isready -U scaffold -d scaffold']
```

Migration 成功后 API 才启动：

```text
postgres healthy → migration completed successfully → API/Worker
```

## 8. Healthcheck 参数

- `interval`：检查频率；
- `timeout`：单次上限；
- `retries`：失败次数；
- `start_period`：启动宽限期。

检查必须轻量、真实且不产生副作用。过严会 Restart Storm，过松会向坏实例发流量。

## 9. Environment

Compose `environment` 会覆盖 Image ENV。不要在提交的 Compose 中放生产 Secret。开发默认 Secret 必须被 Schema 禁止用于 Production。

使用：

```bash
docker compose config
```

查看合并后的配置；输出可能包含 Secret，CI/日志中要谨慎。

## 10. Profiles/Override 思维

团队可使用 Override 区分：

- 只启动依赖；
- Host 热更新；
- 全容器 Smoke；
- 可选 OIDC/微信/SMS Provider。

避免复制多份逐渐漂移的 Compose 文件。

## 11. 数据生命周期实验

1. 创建 User/Project；
2. `docker compose down`；
3. `docker compose up -d postgres`；
4. 验证数据仍在；
5. 在专用实验环境执行 `down -v`；
6. 重启并验证数据库为空/Migration 需重跑。

记录 Container 与 Volume 的不同生命周期。

## 12. 网络故障实验

```bash
docker compose stop postgres
curl -i http://localhost:3000/api/health/live
curl -i http://localhost:3000/api/health/ready
```

预期：API Process 可能仍 Live，Ready 失败。恢复 PostgreSQL 后观察是否自动恢复连接。

## 13. 验收问题

1. 为什么 Container 内不能用 localhost 连接另一个 Service？
2. 为什么 Service DNS 比 Container IP 稳定？
3. Named Volume 是否等于 Backup？
4. `depends_on` 与 Healthcheck 有何区别？
5. 为什么数据库端口生产不应直接 Publish？
6. Cache Redis 和 Queue Redis 为什么分开？

---

[上一章：Dockerfile 与构建](02-dockerfile-build.md) · [返回模块目录](README.md) · [下一章：容器运行、安全与排障](04-docker-runtime-debug-security.md)
