# 20. 进阶练习与能力地图

> [返回教程首页](README.md)

建议按顺序完成：

## 初级

1. 给 Project 增加 `description`，允许为空但限制 2000 字；
2. 把 Project 列表响应改为 `{ data, nextCursor }`；
3. 为 Tasks 模块补齐 Unit + E2E；
4. 为统一错误响应增加稳定 `code`；
5. 为 Swagger 补齐请求/响应 Schema。

## 中级

1. 给 Task 增加 `version` 并实现乐观锁；
2. 增加 Task Assignee，并验证 Assignee 是同租户成员；
3. Task 创建后通过 Outbox 发送通知；
4. 实现审计日志查询接口，只允许 OWNER/ADMIN；
5. 实现幂等创建 Project，检测相同 Key 不同 Payload；
6. 为列表增加 Cursor Pagination 与索引验证；
7. 增加 Worker 的 Event Version 和未知版本处理。

## 高级

1. 接入 BullMQ，按邮件、Webhook、导出拆队列；
2. 建立 DEAD Event 审计重放 CLI；
3. 接入 Redis Cache-aside，模拟 Redis 完全丢失；
4. 用 MinIO 实现 Pending → Quarantined → Scanning → Available 文件状态机；
5. 增加 OpenTelemetry Trace，让 API 请求与 Outbox 投递关联；
6. 用 Testcontainers 隔离 E2E 数据库；
7. 对 Task 列表做 k6 压测并优化索引；
8. 演练 PostgreSQL 恢复和 Worker 崩溃重领；
9. 建立 OpenAPI Breaking Change CI；
10. 只有在测量证明需要时，尝试提取一个独立服务并补齐服务认证和契约测试。

## 完成标准

如果你能独立解释并实现下面这条链路，就已经具备使用这套栈做后端研发的核心能力：

```text
需求
→ API 契约
→ Zod 边界
→ Actor/租户授权
→ Service 业务规则
→ Prisma 约束与事务
→ Audit/Outbox
→ Worker 幂等副作用
→ Unit/E2E
→ 日志、指标、部署与回滚
```

---
