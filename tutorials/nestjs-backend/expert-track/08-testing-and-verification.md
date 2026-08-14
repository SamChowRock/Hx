# 测试策略、属性测试与故障注入

> [返回专家训练目录](README.md)

## 1. 测试的目标是证明风险，不是追求覆盖率数字

把风险映射到测试层：

| 风险                          | 最合适测试                   |
| ----------------------------- | ---------------------------- |
| Role Matrix                   | Unit/Table-driven            |
| Zod/Token Pure Rule           | Unit/Property                |
| Prisma Constraint/Transaction | Integration/E2E              |
| Cookie/CSRF/Filter            | HTTP E2E                     |
| Worker Retry                  | Unit + DB Integration        |
| 多请求竞争                    | Real PostgreSQL Concurrency  |
| Provider Contract             | Mock Server/Contract         |
| 部署/Migration                | Previous Schema Upgrade Test |
| 性能/过载                     | Load Test                    |
| 恢复能力                      | Failure/Restore Drill        |

## 2. Test Pyramid 不是固定比例

大量快速规则测试，适量真实数据库/API 测试，少量昂贵端到端/Provider 测试。认证、多租户和事务等高风险边界可以有更多 E2E。

## 3. Mandatory Lab A：Permission Matrix Generator

为所有 Organization Action 建表驱动测试：

```ts
it.each([
  ['OWNER', 'manage_members', true],
  ['ADMIN', 'manage_members', true],
  ['MEMBER', 'manage_members', false],
  ['VIEWER', 'manage_members', false],
] as const)(...);
```

再建立 HTTP E2E 抽样，证明 Controller → Actor → Policy 接线正确。

## 4. Mandatory Lab B：Property Test 思维

即使不引入库，也可以生成大量输入验证：

- Cursor encode/decode round-trip；
- 任意字段顺序产生相同 Request Hash；
- 任意不同 Session 的 CSRF 不匹配；
- Safe Return URL 永不逃离 Web Origin；
- Phone Normalize 输出要么合法 E.164，要么拒绝。

若引入 fast-check 等库，固定 Seed 以便复现失败。

## 5. Contract Test

对 Outbox Event：

```text
Producer Fixture
→ JSON 序列化
→ Consumer Zod Parse
→ Handler
```

保留 v1 Fixture，即使 Producer 已升级 v2，直到保留期内无 v1 Event。

## 6. Mutation Testing 思维

手工尝试删掉一行安全条件：

- 去掉 `organizationId` Scope；
- 允许 VIEWER；
- 去掉 CSRF；
- 去掉 `consumedAt: null`；
- 去掉 Transaction；
- 去掉 Unique。

相关测试必须失败。如果仍全绿，测试没有保护真正不变量。

## 7. Mandatory Lab C：Fault Injection

建立只在 Test 可用的依赖接口：

```text
Database fail before audit
SMTP timeout
Worker crash after provider success
Redis unavailable
OIDC discovery timeout
WeChat code exchange timeout / redirect / oversized response
```

验证：事务回滚、重试分类、降级、错误脱敏和最终状态。

## 8. Time Testing

把 Clock 作为依赖或集中封装，避免到处直接 `new Date()` 导致难以控制。测试：

- Expiry 边界前 1ms/等于/后 1ms；
- Idle Touch Interval；
- OTP Cooldown/Window；
- Outbox availableAt；
- DST/时区业务规则。

## 9. Test Data Builder

建立表达业务意图的 Builder：

```ts
await fixture.activeUser().ownerOf(org).withSession().create();
```

不要让每个测试复制 50 行 Prisma Seed。Builder 默认生成合法数据，测试只覆盖差异；同时避免隐藏关键权限条件。

## 10. E2E 数据库隔离

改进当前 `TRUNCATE scaffold` 风险：

- Database Name 必须包含 test；
- CI 用临时 PostgreSQL；
- Suite/Worker 独立 Schema 或 Database；
- Migration 从空库和上一版本都测试；
- Cleanup 失败不会污染下一次；
- 并行策略明确。

## 11. Snapshot 的边界

不要用巨大 JSON Snapshot 替代语义断言。Snapshot 适合稳定 Contract Artifact；安全规则应明确断言状态码、Code、数据库副作用和脱敏字段。

## 12. Flaky Test 诊断

记录 Seed、时间、端口、数据库、并发、日志。先证明是共享状态、时间、顺序、资源还是 Retry，再修 Root Cause。禁止简单增加 Sleep 或自动重跑掩盖。

## 13. Coverage Review

不只看 Line Coverage。建立不变量覆盖表：

```text
Invariant | Unit | E2E | Concurrency | Failure | Migration
```

每个高风险不变量至少有一个权威测试层。

## 14. 交付物

- Risk → Test Matrix；
- Permission Table Tests；
- 3 个 Property Tests；
- Event Contract Fixtures；
- Mutation Review；
- Fault Injection Suite；
- 安全测试数据库 Guard；
- Flaky Test Runbook。
