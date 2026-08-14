# Outbox、Worker、重试与故障恢复

> [返回专家训练目录](README.md)

## 1. 目标

从“会把邮件放到 Worker”进阶到能回答：

- API 在任意一行崩溃会留下什么；
- Worker 重复执行是否安全；
- Provider 成功但 Ack 失败怎么办；
- 任务积压、毒消息和 Dead 如何运维；
- 多 Worker 如何竞争和恢复陈旧锁。

## 2. 写 Failure Matrix

以注册邮件为例：

| 故障点                       | 数据库状态                   | 用户看到     | 恢复                       |
| ---------------------------- | ---------------------------- | ------------ | -------------------------- |
| Intent 前失败                | 无                           | 5xx/连接失败 | 安全重试                   |
| Intent 写入后、Outbox 前抛错 | 同事务回滚                   | 5xx          | 安全重试                   |
| Commit 后响应丢失            | Intent + Outbox              | 网络错误     | 请求幂等/通用响应          |
| Claim 后 Worker 崩溃         | PROCESSING + lockedAt        | 已接受       | 陈旧锁恢复                 |
| SMTP 成功后 Worker 崩溃      | Provider 已发，仍 PROCESSING | 可能收到邮件 | 稳定 Message ID/消费者去重 |
| 最大重试                     | DEAD                         | 邮件不到     | 告警、调查、审计重放       |

## 3. Mandatory Lab A：Provider 故障

```bash
docker compose stop mailpit
```

发起邮箱注册，观察：

- API 仍返回 Accepted；
- Outbox 从 PENDING → PROCESSING → PENDING；
- attempts 增加；
- availableAt 指数后移；
- lastError 不含 Provider Secret；
- 日志包含 Event ID/Type。

恢复：

```bash
docker compose start mailpit
```

等待投递成功，验证 Payload 脱敏。

## 4. Mandatory Lab B：崩溃窗口

在测试分支给 Worker 增加可控 Failure Hook：

```text
after_provider_success_before_delivered_update
```

Provider Mock 记录成功，随后进程抛错。让锁陈旧或缩短测试 stale 时间，再次执行。证明同一逻辑消息可能发送两次。

不要在生产留下任意故障开关；测试 Hook 必须显式只在 test 环境。

## 5. Idempotent Consumer

不同副作用的策略：

| 副作用         | 幂等策略                                    |
| -------------- | ------------------------------------------- |
| Email          | 稳定 Message ID，接受可能重复               |
| SMS            | Provider Idempotency 支持或业务 Send Record |
| 创建下游资源   | 传稳定 Idempotency Key                      |
| Webhook        | Logical Event ID，消费者去重                |
| 数据库派生状态 | Inbox/Processed Event Unique                |
| 文件处理       | `(fileId, processingVersion)` Unique        |

## 6. Claim 算法评审

当前 Find Candidate + Conditional `updateMany` 是 Compare-and-set。测试多个 Worker 同时 Claim 同一 Event，只有一个获得 `count=1`。

进一步考虑：

- 没抢到后是否立即继续找下一条；
- 多 Worker 是否反复争同一个头部 Candidate；
- 是否需要 `FOR UPDATE SKIP LOCKED`；
- Batch Size 和 Transaction；
- Tenant/Type 公平性；
- Poison Event 是否阻塞队头；
- Clock Skew 对 lockedAt/availableAt 的影响。

## 7. Retry Classification

定义 Typed Failure：

```text
Transient: timeout, connection reset, 429, selected 5xx
Permanent: invalid payload, unsupported version, invalid recipient
Unknown: provider response cannot classify
```

Transient 才指数重试；Permanent 直接 DEAD 并带安全错误 Code。429 尊重 Retry-After。所有 Retry 有最大次数和总时间预算。

## 8. Backoff 与 Jitter

```text
delay = min(cap, base * 2^attempt)
jittered = random(0, delay)
```

没有 Jitter 时，Provider 恢复瞬间所有失败任务同时重试，形成 Thundering Herd。

## 9. Event Contract Version

```json
{
  "version": 1,
  "taskId": "...",
  "recipientUserId": "..."
}
```

Consumer 必须：

- Parse Version；
- 支持仍在保留期内的旧版本；
- 未知版本安全 DEAD；
- 不把内部 Prisma Entity 整体塞入 Payload；
- Event Schema 有 Contract Test。

## 10. Ordering

假设 `task.created` 和 `task.deleted` 并发到达，Worker 可能乱序。设计：

- Consumer 读取当前数据库状态而不是盲信 Event；
- Entity Version；
- 每 Aggregate 顺序 Key；
- 幂等状态转换；
- 业务可接受乱序则不引入昂贵全局顺序。

## 11. Dead Event Runbook

Runbook 至少包含：

1. 告警阈值；
2. 查询 Event ID/Type/Attempts/安全错误 Code；
3. 判断 Provider、Payload、代码版本或数据问题；
4. 修复前禁止盲目批量重放；
5. 选择单条/批次重放；
6. 重放保持 Logical ID；
7. 操作者、理由、数量写 Audit；
8. 观察成功率和副作用重复；
9. 事故后清理/保留。

## 12. BullMQ 迁移设计

当引入 BullMQ 时，Outbox Publisher 可以把 PostgreSQL Event 发布到 Queue。分析新的失败窗口：

- Queue 已写但 Outbox 未标记；
- 重复 Queue Job；
- Redis 不可用；
- Job 删除/保留；
- Queue 与数据库恢复时间差。

稳定 Job ID + 幂等 Consumer 仍然必要。

## 13. 验收指标

- Outbox Pending Count/Age；
- Claim Throughput；
- Delivery Success/Failure by Type；
- Retry/Dead Count；
- Provider Latency；
- Stale Lock Recovery；
- Oldest Event Age；
- Duplicate Suppression Count。

## 14. 交付物

- Failure Matrix；
- Provider Down/Crash Window 测试；
- Typed Retry Policy；
- Event Version Schema；
- Dead Replay CLI 设计与 Runbook；
- 多 Worker 竞争测试；
- BullMQ 迁移 ADR。
