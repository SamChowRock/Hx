# Migration、发布、回滚与恢复

> [返回专家训练目录](README.md)

## 1. 发布是一个分布式状态转换

滚动发布期间同时存在：

```text
旧 API + 新 API
旧 Worker + 新 Worker
已执行的新 Schema
旧/新 Event Payload
旧 Browser/Mobile Client
```

任何一步都必须兼容邻近状态。

## 2. Build Once, Promote

同一 Commit 构建一次不可变镜像，记录 Digest、SBOM 和 Migration 集合。Staging 验证后晋级同一 Digest，不在 Production 重新构建。

## 3. Mandatory Lab A：Expand/Contract

需求：Project `name` 迁移到 `displayName`。

### Release 1：Expand

- 新增可空 display_name；
- 应用继续读 name，同时双写；
- Migration 与旧应用兼容。

### Backfill

- 按 ID Cursor 分批；
- 每批有限大小；
- 可重试且幂等；
- 记录进度、速率、错误；
- 控制数据库负载。

### Release 2：Switch

- 读取 display_name；
- 暂时继续双写；
- 监控 null/差异。

### Release 3：Contract

- 停止写 name；
- 确认无旧实例；
- 独立 Migration 删除旧列。

为每个 Release 写 Rollback 行为。

## 4. Mandatory Lab B：上一版本升级测试

CI 不只从空库 Migration。准备上一 Release Schema + 数据 Snapshot：

1. 启动上一版本 DB；
2. 插入代表性数据；
3. 执行当前 `migrate deploy`；
4. 启动新应用；
5. 跑 Smoke/E2E；
6. 验证旧数据和约束。

## 5. Migration 风险评审

检查：

- Table Rewrite；
- Lock Level/Duration；
- Index Build；
- NOT NULL Validation；
- Foreign Key Validation；
- 大量 WAL/Replica Lag；
- Transaction Size；
- 磁盘临时空间；
- 应用兼容；
- 失败后重跑。

## 6. Worker/Event 发布顺序

如果新 API 产生 Event v2，而旧 Worker 不认识：

```text
先部署能同时处理 v1/v2 的 Worker
→ 再部署产生 v2 的 API
→ 等 v1 保留期结束
→ 最后删除 v1 Consumer
```

Consumer-first 是常见兼容策略。

## 7. Feature Flag

Flag 可把“部署代码”和“开放行为”分开，但也增加状态组合。定义：Owner、默认值、清理日期、监控、Kill Switch 和权限。永久 Flag 是债务。

## 8. Rollback Decision

回滚应用前问：

- 新代码是否写入旧代码不认识的数据；
- Schema 是否兼容；
- 新 Event 是否已产生；
- 外部副作用是否不可逆；
- Session/Cookie 是否变化；
- 回滚会不会造成更大重复/数据损坏。

## 9. Mandatory Lab C：备份恢复

在本地测试环境：

1. 创建代表性用户/组织/Project/Outbox；
2. 执行逻辑备份；
3. 删除测试数据库或恢复到新数据库名；
4. 执行 Migration；
5. 启动应用；
6. 验证数据、约束、Session/Outbox 语义；
7. 记录实际 RTO/RPO。

“有备份”不等于“能恢复”。

## 10. Graceful Shutdown Drill

在持续请求和 Worker 投递时发送 SIGTERM。验证：

- Readiness 停止流量；
- 新 Job 不再 Claim；
- In-flight 有有限 Drain；
- DB Connection 关闭；
- 没有无界卡住；
- 重启后陈旧 Work 可恢复。

## 11. Canary 与观测

先给少量流量，比较新旧版本：

- Error/Latency；
- DB Query/Lock；
- Outbox；
- Memory/CPU；
- 业务成功率。

自动回滚条件必须避免因短暂噪音造成 Oscillation。

## 12. 供应链

- Lockfile/Frozen Install；
- 依赖和镜像扫描；
- SBOM；
- 非 root/只读文件系统；
- 镜像签名和 Provenance；
- Secret 不进 Layer；
- 基础镜像更新策略。

## 13. 交付物

- Expand/Contract 三阶段实现；
- 上一版本 Upgrade Test；
- Migration Risk Checklist；
- Event Consumer-first 发布计划；
- Backup/Restore 报告；
- Graceful Shutdown Drill；
- Rollback Runbook。
