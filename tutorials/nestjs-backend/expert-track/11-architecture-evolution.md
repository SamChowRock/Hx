# 模块化单体演进与架构决策

> [返回专家训练目录](README.md)

## 1. 架构能力是控制复杂度，不是增加组件

专家要能回答：

- 当前最贵的复杂度是什么；
- 哪个边界稳定，哪个仍在探索；
- 提取服务的收益能否覆盖分布式成本；
- 团队是否能运维新组件；
- 如何用数据而不是审美做决策。

## 2. 模块边界评审

对 Identity、Authorization、Projects、Organizations、Worker 画：

```text
Owned data
Public application API
Inbound dependencies
Outbound dependencies
Events
Transactional boundary
Security boundary
Change cadence
```

识别违规：Controller 跨模块直查表、循环依赖、CommonService、共享可变 DTO、暴露 Prisma Entity。

## 3. Mandatory Lab A：Use Case 重构

当 TasksService 变大后，把 `CreateTaskUseCase` 提取为明确 Provider：

```text
api/ controller + schema + mapper
application/ create/list/update use cases
domain/ policy/state transition
infrastructure/ prisma repository
```

要求：

- 不为目录而目录；
- Use Case 仍使用同一 Transaction；
- 权限和租户边界不后退；
- E2E Contract 不变；
- 测试更容易而非 Mock 更多。

写前后复杂度评估。

## 4. Dependency Rule

Domain/Application 不应依赖 HTTP Decorator 或 Provider SDK。基础设施实现接口并由 Module 组装。

但不要把 Prisma 简单 CRUD 全部包装成无价值 Repository。接口应代表领域需要和可替换边界。

## 5. ADR 训练

每份 ADR：Context、Decision、Alternatives、Consequences、Reconsider When。

Mandatory ADR 任选：

- Session Store 是否迁 Redis；
- PostgreSQL Poller 是否引入 BullMQ；
- Tenant Isolation 是否启用 RLS；
- Tasks 是否拆服务；
- Zod/OpenAPI 集成方案。

## 6. 服务提取门槛

真实信号：

- 独立扩缩容差异巨大；
- 独立可靠性/安全边界；
- 不同团队独立发布；
- 技术运行时要求；
- 模块变更长期互相阻塞。

非理由：代码多、听起来高级、简历需要、未来可能很大。

## 7. 提取成本清单

一旦拆服务，需要：

- 服务身份与授权；
- 网络 Timeout/Retry/Circuit Breaker；
- API/Event Version；
- 数据所有权和迁移；
- 跨服务一致性/Saga；
- Trace/Correlation；
- Consumer Contract Test；
- 独立部署、值班和容量；
- 本地开发复杂度；
- 事故影响面。

## 8. Mandatory Design Exercise：提取 Notification Service

比较三种方案：

1. 当前 Monolith Worker；
2. 同仓库独立 Notification Process；
3. 独立 Service + Owned DB/Broker。

用实际指标假设：吞吐、团队、SLO、Provider 数量、合规边界。给出当前选择和重评阈值。

## 9. 数据所有权

服务拆分后禁止直接跨服务数据库访问。Notification 不应查询 Identity 私有表；Producer Event 要包含最小稳定信息，或通过受控 API 获取。

这会引入数据复制和最终一致性，必须定义 Source of Truth 和修复流程。

## 10. Saga/补偿

跨服务无法用一个 PostgreSQL Transaction。设计：

```text
Create Organization
→ Provision Billing
→ Setup Notification
```

每步有状态、幂等和补偿。补偿不是数据库回滚；邮件发出、第三方资源创建可能只能再执行反向业务动作。

## 11. 架构适应度函数

把边界转成自动检查：

- 禁止 Module 跨层 Import；
- Public API Contract Diff；
- 跨租户 E2E；
- Migration Compatibility；
- 性能 Budget；
- Event Contract Fixture。

## 12. 交付物

- 模块依赖图；
- Use Case 重构；
- 一份完整 ADR；
- Notification 提取评估；
- 数据所有权图；
- Saga 设计；
- 至少一个自动架构约束。
