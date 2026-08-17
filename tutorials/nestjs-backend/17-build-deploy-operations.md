# 17. 构建、容器化与上线

> [返回教程首页](README.md)

本章说明通用的构建与发布原则；需要直接选择大陆或海外的低运维服务组合时，继续阅读[初创项目的低运维生产方案](deployment/README.md)。

## 17.1 本地构建

```bash
pnpm build
```

`prebuild` 会先执行 `prisma:generate`，随后 TypeScript 输出到 `dist/`：

```text
dist/apps/api/src/main.js
dist/apps/worker/src/main.js
```

运行产物：

```bash
pnpm start:api
pnpm start:worker
```

## 17.2 Docker 多阶段构建

`Dockerfile` 分为：

- `base`：Node Alpine、工作目录、非 root 用户；
- `dependencies`：按 Lockfile 安装依赖；
- `build`：生成 Prisma、编译、裁剪开发依赖；
- `migration`：专门执行 Migration；
- `runtime`：只复制生产依赖和 dist，以非 root 用户启动。

Compose 还为 API/Worker 设置：

- 只读根文件系统；
- `/tmp` 使用 tmpfs；
- 删除 Linux Capabilities；
- `no-new-privileges`；
- `init: true` 处理信号和僵尸进程。

## 17.3 推荐发布顺序

```text
构建一次不可变镜像
    ↓
在兼容性检查后执行 forward-only Migration
    ↓
部署/滚动更新 API 与 Worker
    ↓
检查 readiness、日志、错误率和 Outbox 积压
    ↓
出现问题时回滚应用版本；数据库变更需遵循兼容设计
```

不要让每个 API Replica 启动时同时自动跑 Migration。使用一次性 Migration Job。

## 17.4 上线前配置检查

- `NODE_ENV=production`；
- 随机且由 Secret Manager 管理的 `AUTH_SECRET`，至少 32 字符；
- `WEB_APP_ORIGIN`、`API_PUBLIC_ORIGIN` 使用 HTTPS；
- CORS 只允许明确 Origin；
- `TRUST_PROXY` 与入口代理拓扑一致；
- PostgreSQL 使用 TLS、备份和 Point-in-time Recovery；
- SMTP/Twilio/OIDC/微信 AppSecret 等凭据来自 Secret Manager；
- 日志已集中收集并验证脱敏；
- API 和 Worker 有独立健康、资源和扩容配置；
- Outbox DEAD、积压和投递延迟有告警；
- Migration 已在上一版本数据库副本上演练；
- Swagger 不在 production 暴露；
- 恢复手册、回滚步骤和负责人明确。

## 17.5 当前仍需补齐的生产能力

这个仓库是 production-oriented scaffold，不等于开箱即用的完整生产平台。仍需要按实际部署补充：

- Secret Manager；
- OpenTelemetry/错误上报；
- 指标、Dashboard 和告警；
- 托管数据库备份与恢复演练；
- CI/CD 和镜像签名/SBOM；
- Outbox 管理与重放工具；
- 管理端、权限审计查询；
- 文件隔离扫描；
- 依赖与容器安全扫描；
- 生产负载和故障演练。

## 17.6 一条实用 CI Pipeline

可以把流水线划分为：

```text
Install（锁版本）
├─ Format + Lint + Typecheck
├─ Unit Test
├─ 启动临时 PostgreSQL
│  ├─ migrate deploy
│  └─ E2E
├─ Build
├─ Docker Build + Smoke Test
├─ Dependency/Image Scan + SBOM
└─ 发布不可变镜像
```

部署阶段再：

```text
备份/确认恢复能力
→ 一次性 Migration Job
→ 滚动 API/Worker
→ Readiness 与 Smoke Test
→ 监控错误率、延迟、数据库与 Outbox
→ 人工/自动晋级
```

同一个 Git Commit 只构建一次镜像，在 Staging 验证后把同一 Digest 晋级 Production；不要在每个环境重新 Build，避免产物漂移。

## 17.7 Expand/Contract 发布示例

假设把 `Project.name` 拆为 `displayName`，不要一次删除旧列：

1. **Expand**：新增可空 `display_name`，旧 `name` 保留；
2. 部署同时写两列、读取旧列的版本；
3. 后台分批 Backfill，记录进度并可重试；
4. 部署读取新列、仍双写的版本；
5. 观察一段时间，确认无旧版本实例；
6. 停止写旧列；
7. **Contract**：后续独立 Migration 删除旧列。

这让应用滚动更新和数据库变更互相兼容。直接 Rename/Drop 在本地看似简单，生产滚动期间可能让一半实例崩溃。

## 17.8 回滚不只是 `git revert`

回滚前问：

- 新版本是否已经写入旧代码不认识的数据；
- Migration 是否向后兼容；
- Worker 是否已经消费新 Event Type；
- 回滚后旧 Worker 遇到新 Payload 会怎样；
- Session/Cookie 格式是否改变；
- 外部副作用是否已经不可逆发生。

因此 Event 和 API 需要版本化，Migration 需要兼容窗口，外部副作用需要幂等和补偿流程。

## 17.9 SLO 为什么会影响代码设计

项目参考目标是：API 月可用性 99.9%、读取 p95 小于 300ms、写入 p95 小于 700ms、RTO 4 小时、RPO 15 分钟。

这些数字不是文档装饰：

- 99.9% 每月大约允许 43 分钟不可用，决定告警和冗余投入；
- p95 表示 95% 请求低于目标，不能只看平均值掩盖长尾；
- 700ms 写入预算意味着不能无上限等待 SMTP/第三方；
- RTO 决定事故后恢复服务的时间目标；
- RPO 决定最多能丢多少已提交数据，驱动备份/PITR 频率。

依赖 Timeout 应来自整体延迟预算。例如 API 目标 700ms，却给三个串行下游各 5 秒 Timeout，目标在设计上已经不可能。异步化、并行、缓存和降级都应由测量与 SLO 驱动。

## 17.10 优雅关闭为什么重要

容器发布时会收到 SIGTERM。如果进程立刻退出：

- 正在响应的 HTTP 请求被切断，但数据库可能已提交；
- Worker 可能已发邮件但未标记 DELIVERED；
- 连接未释放；
- Load Balancer 还可能继续发流量。

正确顺序：

```text
Readiness 变为失败
→ Load Balancer 停止新流量
→ 停止领取新 Job
→ 给进行中的 HTTP/Job 有限 Drain 时间
→ 关闭数据库/Redis/Provider 连接
→ 到达上限后强制退出
```

本项目启用 Shutdown Hooks，Database 会 Disconnect，Worker 会清除 Poll Timer 并等待当前 Poll Promise。未来接入完整部署时还需 Readiness Drain 和明确终止宽限期。

## 17.11 过载时要拒绝，而不是一起拖死

系统资源有限：CPU、内存、数据库连接、磁盘、Provider 配额。过载保护包括：

- 请求 Body/文件大小上限；
- 分页和最大导出范围；
- Rate Limit 和 Tenant Quota；
- Argon2 并发上限；
- Worker 每类任务并发；
- 数据库 Pool 上限和查询 Timeout；
- Queue 长度/年龄告警；
- Circuit Breaker 与 Bulkhead；
- 429/503 + Retry-After；
- 低优先级功能降级。

如果不限制，一个大导出或登录攻击可能占满数据库/CPU，让健康检查、普通读取和管理员修复也无法执行。Backpressure 的核心是让系统在容量边界内可预测地拒绝部分工作，而不是随机崩溃。

## 17.12 水平扩展之前先找真正瓶颈

多加 API Replica 只解决 API CPU/并发，不自动解决：

- PostgreSQL 慢查询和连接上限；
- 单个热 Tenant/Hot Row 锁竞争；
- Worker Provider 配额；
- Redis Hot Key；
- Object Storage/网络带宽；
- 一段同步 CPU 密集代码；
- 错误 Retry Storm。

扩容流程：

1. 指标定位瓶颈资源；
2. 查算法、Query、Index、N+1 和无界输入；
3. 做负载测试复现；
4. 优化后再次测量；
5. 再决定纵向/横向扩展或架构变化；
6. 同步调整连接池、限额和告警。

“上 Kubernetes”不会修复一个无索引查询。

---
