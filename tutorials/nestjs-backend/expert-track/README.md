# NestJS 后端专家训练路线

> [返回基础教程首页](../README.md)

这不是“再读一遍更长的教程”，而是一套基于当前仓库的训练计划。每个模块都要求你修改代码、制造失败、收集证据并完成设计评审。

## 先说清楚：读完不等于专家

后端能力可以分成四级：

| 等级      | 表现                                                   |
| --------- | ------------------------------------------------------ |
| L0 了解   | 能解释术语和现有代码大意                               |
| L1 能跟做 | 按教程能完成一个功能，但离开步骤容易卡住               |
| L2 独立   | 能从需求设计数据、权限、事务、测试和发布方案           |
| L3 专家   | 能在并发、故障、安全和演进约束下做取舍，并诊断生产问题 |

现有基础教程主要带你到 L1～L2。这条路线的目标是通过刻意训练逼近 L3。真正达到专家仍需要生产流量、事故、评审和长期维护经验。

## 训练模块

1. [训练方法、实验环境和证据要求](00-training-method.md)
2. [领域建模、不变量与状态机](01-domain-modeling.md)
3. [PostgreSQL、查询计划与数据演进](02-postgresql-query-design.md)
4. [事务、隔离、锁与并发控制](03-transactions-and-concurrency.md)
5. [API 契约、分页、幂等与兼容性](04-api-contracts-and-idempotency.md)
6. [认证、授权、多租户与威胁建模](05-auth-security-and-multitenancy.md)
7. [Outbox、Worker、重试与故障恢复](06-outbox-worker-reliability.md)
8. [缓存、性能、容量与负载测试](07-cache-performance-and-load.md)
9. [测试策略、属性测试与故障注入](08-testing-and-verification.md)
10. [可观测性、SLO 与事故响应](09-observability-and-incidents.md)
11. [Migration、发布、回滚与恢复](10-deployment-and-migrations.md)
12. [模块化单体演进与架构决策](11-architecture-evolution.md)
13. [毕业项目：生产级 Organization Invitation](12-capstone-organization-invitations.md)
14. [能力评审量表与答辩问题](13-assessment-rubric.md)

## 推荐节奏

| 周     | 模块   | 主要产出                          |
| ------ | ------ | --------------------------------- |
| 1      | 00～01 | Project 状态机、ADR、不变量清单   |
| 2      | 02     | 查询计划报告、索引对比、Migration |
| 3      | 03     | 并发复现、乐观锁与事务测试        |
| 4      | 04     | 幂等写接口、游标分页、契约测试    |
| 5      | 05     | 跨租户攻击测试、威胁模型          |
| 6      | 06     | Worker 故障实验、重放 Runbook     |
| 7      | 07     | 负载基线、缓存策略和容量报告      |
| 8      | 08     | 测试矩阵、故障注入和数据生成      |
| 9      | 09     | SLI/SLO、Dashboard 草图、事故复盘 |
| 10     | 10     | Expand/Contract、回滚和恢复演练   |
| 11     | 11     | 架构评审、模块边界与提取条件      |
| 12～14 | 12～13 | 毕业项目、答辩和能力评审          |

## 每个模块必须交付的证据

- 一份设计说明，写清不变量和替代方案；
- 一组成功、拒绝、并发和失败测试；
- 一次真实运行记录，而不仅是 Mock；
- 一份“为什么这么做”的评审说明；
- 一次失败复现和修复前后对比；
- 对代码、数据库、运行和发布影响的总结。

## 前置内容

开始前至少完成：

- [后端核心思维](../mindset/README.md)
- [Prisma 与 PostgreSQL](../08-prisma-and-postgresql.md)
- [认证](../09-authentication.md)
- [授权与多租户](../10-authorization-and-multitenancy.md)
- [Tasks 实战](../workshop/README.md)
- [事务与一致性](../12-transactions-audit-consistency.md)
- [Outbox 与 Worker](../13-outbox-workers-and-cache.md)

## 通过标准

不要用“看完了”作为完成标准。满足以下条件才算通过：

```text
能够独立设计
+ 能用测试证明不变量
+ 能复现并发/故障
+ 能解释替代方案和代价
+ 能安全发布与回滚
+ 能通过日志、指标和数据诊断问题
```
