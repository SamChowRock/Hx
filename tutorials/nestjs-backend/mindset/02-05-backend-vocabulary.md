# 后端核心词汇：从前端交互到可靠业务系统

> [返回核心思维目录](README.md)

这一册专门解释后续章节反复出现、但前端研发不一定天然熟悉的词。先理解“系统为什么需要它”，再看 NestJS、Prisma 或 Redis 的实现。

## 1. 一次点击不等于一个可靠结果

前端常见视角是：

```text
用户点击 → fetch → 收到 200 → 更新 UI
```

后端必须额外面对：请求可能重试、网络可能超时、进程可能在两步之间崩溃、两个请求可能同时修改同一数据、浏览器可能断线后重新连接。因此同一次“添加成员”更像：

```text
可信身份 → 权限判断 → 数据库事务提交事实
→ 记录需要做的后续工作 → 后台执行 → 客户端最终观察到结果
```

后面所有术语都在描述这条链路的某一个责任。

## 2. Actor、Tenant、Action、Resource：授权的四个坐标

| 词       | 简单解释                | Project 例子                | Notification 例子         |
| -------- | ----------------------- | --------------------------- | ------------------------- |
| Actor    | 谁在操作                | Session 验证后的 Alice      | Session 验证后的 Alice    |
| Tenant   | 数据属于哪个隔离空间    | Organization A              | 用户 Alice 自身的通知空间 |
| Action   | 想做什么稳定业务动作    | `create_project`            | `mark_notification_read`  |
| Resource | 正在操作的具体对象/集合 | Organization A 下的 Project | Notification N            |

认证只负责建立 Actor；授权要用这四个坐标判断请求。前端传来的 `userId`、`organizationId` 和资源 UUID 都只是未验证输入，不能直接成为可信事实。

## 3. Source of Truth（事实源）

事实源是“发生争议或断线后，最终以谁为准”的持久状态。

| 状态                              | 本项目的事实源             | 不是事实源的东西         |
| --------------------------------- | -------------------------- | ------------------------ |
| 用户、成员、Project、通知已读状态 | PostgreSQL                 | React state、浏览器缓存  |
| 头像字节                          | 私有对象存储               | `avatarUrl`、内存 Buffer |
| 当前页面红点                      | PostgreSQL 未读 count      | SSE 最近收到的事件       |
| 待投递邮件/通知                   | PostgreSQL `outbox_events` | Worker 内存队列          |

事实源不是“最快的地方”，而是“重启、重连、重试后还能恢复正确答案的地方”。SSE、Redis Cache 和前端状态的价值是快；它们丢失后系统应回到事实源，变慢但仍正确。

## 4. Transaction（事务）：一组事实要么一起成立，要么都不成立

事务不是“把代码包起来就更高级”。它表达业务不变量。

例如把用户加入组织时，至少有三个事实必须一致：Membership 已创建、Audit 已记录、需要通知该用户。如果只执行前两步进程就崩溃，系统会得到“用户已加入但从未被通知”的半成品结果。

```ts
await database.$transaction(async (tx) => {
  await tx.membership.create(/* ... */);
  await tx.auditEvent.create(/* ... */);
  await tx.outboxEvent.create(/* notification.create */);
});
```

事务只能可靠保护同一个 PostgreSQL 内的写入；它不能把“数据库写入”和“发邮件/请求第三方 API”变成一个原子操作。网络调用放在事务里还会延长锁，造成慢请求和死锁风险。

## 5. Outbox：把“稍后必须做的事”也写进同一事务

**Outbox 是数据库中的待投递记录表。** 它不是邮箱发件箱 UI，也不是 Redis Queue；它记录的是“某项业务事实已经提交，因此后续副作用必须最终尝试执行”。

```text
错误做法
  commit Membership → 调 notification API → 进程崩溃
  结果：成员存在，通知意图丢失

Outbox 做法
  一个事务内 commit Membership + notification.create Outbox
  结果：两者一起存在，或者都不存在
  Worker 以后即使重启也会看到待处理记录
```

可以把 Outbox 类比为前端离线应用中的“可靠待同步操作日志”，但它由 PostgreSQL 事务写入并由服务端 Worker 消费。它解决的是 **数据库成功、外部副作用丢失** 的窗口。

Outbox 不是让副作用立刻完成的承诺。请求成功后，邮件/通知可能数秒后才到；这叫最终一致性。HTTP 通常返回的是“业务事实已接受并且投递意图已持久化”，不是“所有外部世界都已经完成”。

## 6. Worker（后台执行者）

Worker 是独立于 HTTP API 的常驻进程。API 的目标是快速验证、提交业务事实、返回响应；Worker 的目标是慢一些也可以、允许重试地执行副作用。

本项目 Worker 每秒从 Outbox 领取可执行事件，处理邮件、SMS 或 `notification.create`。它会：

1. 用 compare-and-set 领取，避免两个 Worker 同时认为自己拥有同一事件；
2. 再用 Zod 验证 Payload，不能信任历史数据；
3. 执行副作用；
4. 成功标记 `DELIVERED`，失败退避重试，超过上限标记 `DEAD`；
5. 完成后脱敏 Payload，减少敏感数据保留。

## 7. At-least-once 与幂等（Idempotency）

Worker 的常见崩溃窗口：第三方已成功接收通知，但 Worker 还没来得及把 Outbox 标成 `DELIVERED`。重启后它会重试。因此现实系统通常保证 **at-least-once（至少尝试一次，可能重复）**，不是 exactly-once。

幂等表示“相同逻辑操作执行多次，最终业务结果与执行一次相同”。

```text
notification.create 重复投递
  → 使用稳定 dedupeKey
  → PostgreSQL UNIQUE(user_id, dedupe_key)
  → 最终只有一条 Notification
```

不要用通知正文、当前时间或“前端应该不会点两次”当去重依据。稳定业务 ID、唯一约束和明确的重复语义才是后端防线。

## 8. Event、Queue、Outbox 不一样

| 词     | 它是什么                        | 本项目对应                                |
| ------ | ------------------------------- | ----------------------------------------- |
| Event  | “发生了什么”的事实描述          | `notification.create` 类型和 Payload      |
| Outbox | 事务内持久化的待执行 Event 记录 | `outbox_events` 表                        |
| Worker | 消费并执行 Event 的程序         | `WorkerService`                           |
| Queue  | 调度、延迟、优先级的投递机制    | 当前尚未接入 BullMQ；未来可由 Outbox 驱动 |

Redis/BullMQ 很擅长调度，但不能自动让 PostgreSQL 业务写入和队列消息原子提交。因此即使将来引入 Queue，关键副作用仍应能从 Outbox 恢复。

## 9. 最小练习：用通知链路检查理解

1. 添加一位组织成员；
2. 在 PostgreSQL 观察 Membership、AuditEvent、Outbox；
3. 看 Worker 把 Outbox 从 `PENDING` 变成 `DELIVERED`；
4. 观察 `notifications` 出现一条记录；
5. 断开浏览器 SSE 后重连，重新请求列表与未读数；
6. 问自己：如果每一步之间进程崩溃，下一次启动如何恢复？

能回答最后一个问题，才算真正理解 Outbox，而不只是记住它的定义。

---

[上一册：API 契约、安全、可运维性与多实例](02-04-contract-security-operations.md) · [下一章：项目结构与模块边界](../05-project-structure.md)
