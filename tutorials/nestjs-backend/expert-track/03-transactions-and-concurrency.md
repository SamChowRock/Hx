# 事务、隔离、锁与并发控制

> [返回专家训练目录](README.md)

## 1. 事务不自动解决所有并发问题

事务只定义一组操作的原子性和隔离范围。下面即使放在事务里也可能 Lost Update：

```text
Tx A 读取 version=1, name=A
Tx B 读取 version=1, name=A
Tx A 写 name=B
Tx B 写 name=C
两个事务都提交，B 的修改消失
```

你仍需 Conditional Update、Lock 或更高隔离级别。

## 2. 必须掌握的异常

| 异常                | 说明                                    | 常见保护                     |
| ------------------- | --------------------------------------- | ---------------------------- |
| Lost Update         | 后写覆盖先写                            | Version/ETag、锁             |
| Non-repeatable Read | 同一事务两次读结果变化                  | Repeatable Read              |
| Phantom             | 条件范围出现新 Row                      | Serializable/Predicate Lock  |
| Write Skew          | 两事务更新不同 Row，共同破坏跨 Row 规则 | Serializable/显式锁/约束重构 |
| Deadlock            | 事务互相等待锁                          | 固定锁顺序、短事务、重试     |
| Duplicate Insert    | 并发检查不存在后都插入                  | Unique Constraint            |

## 3. Mandatory Lab A：Lost Update

先给 Project 增加一个普通更新接口，不带 Version。用同一个初始值并发提交两个不同 name，证明两个都 200 且一个结果丢失。

然后增加：

```prisma
version Int @default(1)
```

使用：

```ts
const result = await tx.project.updateMany({
  where: { id, organizationId, version: expectedVersion },
  data: { name, version: { increment: 1 } },
});
```

验收：一个成功、一个 409；客户端可以安全刷新。

## 4. Mandatory Lab B：重复成员

并发发送两个 `addMember`。先临时移除应用预检查，观察数据库 Unique Constraint 如何成为最终裁判。再恢复预检查，解释两层的不同作用：

- 预检查改善常规错误消息；
- Unique 保证并发正确性。

## 5. 两个 psql Session 观察锁

Terminal A：

```sql
BEGIN;
SELECT * FROM projects WHERE id = $id FOR UPDATE;
```

Terminal B 对同一 Row 执行 Update，观察等待。查询：

```sql
SELECT pid, state, wait_event_type, wait_event, query
FROM pg_stat_activity
WHERE datname = current_database();
```

然后 A Commit，观察 B 继续。

回答：如果 A 在持锁时调用 10 秒 HTTP Provider，会发生什么？

## 6. Deadlock Lab

准备两个 Project。

```text
Tx A: lock project 1 → 再 lock project 2
Tx B: lock project 2 → 再 lock project 1
```

PostgreSQL 会检测并终止其中一个。修复：按稳定 ID 顺序获取锁，并对 Deadlock/Serialization Failure 做有上限 Retry。

Retry 必须重跑整个事务 Callback，不能只重跑最后一条语句。

## 7. Write Skew 设计题：至少一个 OWNER

组织有两个 Owner。两个并发事务分别看到“还有另一个 Owner”，然后各自降级，最终没有 Owner。

设计候选：

- 锁 Organization Row 作为串行化点；
- Serializable Transaction + Retry；
- 单独维护 Primary Owner；
- 用更可约束的数据模型表达；
- 禁止通用降级，使用 Owner Transfer Command。

写 ADR 比较复杂度、吞吐、失败语义和可测试性。

## 8. Transaction Boundary

事务内应包含：

- 必须共同提交的数据库读写；
- 条件检查与写入；
- Audit/Outbox 等原子事实。

事务外应包含：

- Argon2 等昂贵计算（能安全提前时）；
- SMTP/HTTP Provider；
- 大文件处理；
- 用户等待；
- 无关查询。

## 9. Isolation 选择

不要默认所有操作都 Serializable。它更容易产生 Abort/Retry，吞吐成本更高。

选择流程：

1. 写出并发不变量；
2. 在默认隔离级别复现异常；
3. 优先考虑数据库约束或原子 Conditional Update；
4. 需要读集合再决策时考虑锁/Serializable；
5. 设计 Deadlock/Serialization Retry；
6. 负载测试竞争热点。

## 10. 测试要求

普通 Unit Test 无法证明数据库隔离。需要真实 PostgreSQL 并发测试：

```ts
await Promise.allSettled([
  request(...).patch(...).send({ version: 1, name: 'A' }),
  request(...).patch(...).send({ version: 1, name: 'B' }),
]);
```

最终断言：状态码集合、数据库 Version、Audit 数量和不变量。

## 11. 交付物

- 三种并发异常的可重复测试；
- 锁等待截图/查询结果；
- Deadlock 复现与修复；
- Owner Write Skew ADR；
- Transaction Boundary Review；
- Retry Policy（错误类型、次数、Backoff、Idempotency）。
