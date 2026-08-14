# 能力评审量表与答辩问题

> [返回专家训练目录](README.md)

## 1. 评分原则

总分 100。低于 60 说明仍依赖教程；60～79 能独立交付常规功能；80～89 具备高级后端能力；90+ 且有真实生产验证才接近专家。

## 2. 评分表

### 领域与数据：15

- 不变量明确：4
- 状态机/边界完整：3
- Schema/Constraint/Index 合理：4
- 数据保留/Migration：4

### 认证、授权和安全：15

- Actor/Tenant/Action/Resource：4
- 跨租户与 Mass Assignment 防护：4
- Token/Secret/PII：4
- Threat Model/Residual Risk：3

### 事务与并发：15

- Transaction Boundary：4
- 并发异常可复现：4
- Unique/Conditional/Lock 选择：4
- Retry/Deadlock：3

### API 与兼容：10

- Contract/Error Code：3
- Pagination/Idempotency：3
- Version/Backward Compatibility：2
- OpenAPI/Contract Test：2

### 异步与可靠性：15

- Outbox 原子性：4
- At-least-once/幂等：4
- Retry/Dead/Replay：4
- Event Version/Ordering：3

### 测试与证明：10

- Risk-based Test Matrix：3
- Real DB/E2E：2
- Concurrency/Failure Injection：3
- Migration/Contract：2

### 可观测与运维：10

- SLI/SLO/Metrics：3
- 安全日志/Trace：2
- Alert/Runbook：3
- Incident Review：2

### 发布与架构：10

- Expand/Contract/Rollback：3
- Graceful Shutdown/Recovery：2
- ADR/Alternatives：3
- Architecture Evolution：2

## 3. 一票否决

出现任一项不得评为高级/专家：

- 跨租户越权；
- 密码/Token/Secret 明文泄漏；
- 不可安全迁移；
- 写操作重复会造成严重副作用；
- 没有真实数据库/并发测试；
- 不能解释失败后的数据库状态；
- 不知道如何检测和恢复；
- 用“最佳实践”代替取舍理由。

## 4. 答辩问题：数据与事务

1. 为什么 `findUnique` 前的权限检查仍不够？
2. Unique 与应用预检查分别解决什么？
3. 事务为什么不能自动防 Lost Update？
4. 什么场景选 Version，什么场景选 Row Lock？
5. 如何复现 Write Skew？
6. 为什么 Provider 调用不放事务？
7. Migration 如何兼容旧实例？

## 5. 答辩问题：认证与安全

1. Session 和 JWT 的取舍？
2. CORS 为什么不是权限？
3. CSRF Token 为什么绑定 Session？
4. OIDC 的 State、Nonce、PKCE 各防什么？
5. 为什么微信网站扫码不能直接套用 OIDC？OpenID 与 UnionID 的作用域差异是什么？
6. Provider Email 为什么不能自动合并账号？
7. 如何轮换 AUTH_SECRET？
8. 如何防 BOLA/IDOR 和 Mass Assignment？

## 6. 答辩问题：可靠性

1. SMTP 成功、Worker Ack 前崩溃会怎样？
2. 为什么 Exactly Once 通常不可信？
3. Outbox 与 BullMQ 的职责区别？
4. Retry 为什么需要 Jitter？
5. Permanent Error 如何分类？
6. Dead Event 如何安全重放？
7. Event 乱序如何处理？

## 7. 答辩问题：性能与运维

1. 为什么不能先加 Redis？
2. Cache 失效的崩溃窗口？
3. p95 与平均值差异？
4. 如何预算数据库连接？
5. Readiness 与 Liveness 区别？
6. SIGTERM 时正确顺序？
7. 如何识别 Retry Storm？

## 8. 现场实操

随机抽取两项：

- 用 Explain 找慢分页；
- 并发复现 Lost Update；
- 写跨租户 E2E；
- 停 Mailpit 诊断 Outbox；
- 设计 Expand/Contract；
- 从日志和数据库定位一次 403/503；
- 为新 Event 写 Failure Matrix；
- 评审一个危险 Migration。

## 9. 专家标准

接近专家的人应能：

- 在信息不完整时提出关键问题；
- 把业务要求写成可验证不变量；
- 预测并复现并发和故障；
- 用最少复杂度满足当前约束；
- 明确残余风险和重评条件；
- 让系统可观察、可恢复、可安全演进；
- 帮助其他人理解并建立相同能力。

专家不是从不出错，而是能更早暴露风险、限制影响并系统性学习。
