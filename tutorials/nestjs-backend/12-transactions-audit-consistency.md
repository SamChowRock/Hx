# 12. 事务、审计日志与一致性

> [返回教程首页](README.md)

## 12.1 什么时候必须用事务

如果多个写入必须“全成功或全失败”，使用 `$transaction`：

- 创建业务记录 + 审计事件；
- 修改密码 + 撤销全部 Session + 审计；
- 消费一次性注册 Intent + 创建完整账号；
- 业务状态变更 + Outbox Event。

不需要为了一个独立 `findMany()` 开事务。

## 12.2 事务外先做昂贵计算

`completeRegistration()` 会先做 Argon2 Hash，再开始数据库事务。这能缩短持锁时间。原则是：

- 网络请求、密码 Hash、大文件计算尽量不放数据库事务里；
- 只有保证一致性所必需的数据库步骤才放进去；
- 事务中不要发邮件或调用第三方 API。

## 12.3 审计日志不是普通日志

普通应用日志用于排错，可能轮转或采样。审计日志用于回答：

```text
谁，在什么租户下，对什么目标，执行了什么安全/业务动作？
```

当前 `AuditEvent` 包含 Actor、Organization、Action、Target、Request ID 和时间。新增重要写操作时，使用稳定动作名，例如：

```text
task.created
task.completed
organization.member.added
auth.session.revoked
```

不要把密码、Session Secret、邮件 Token 或完整敏感 Payload 放进审计表。

## 12.4 并发更新

如果两个用户同时修改 Task，最后写入者覆盖前者可能不可接受。可增加：

```prisma
version Int @default(1)
```

更新时使用 `updateMany({ where: { id, version }, data: { ..., version: { increment: 1 } } })`。若 `count === 0`，返回 409，提示客户端刷新。这叫乐观并发控制。

## 12.5 事务最常见的隐藏错误

下面看起来在事务中，实际第二次写入使用了外层 Client：

```ts
await this.database.$transaction(async (tx) => {
  const task = await tx.task.create(...);
  await this.database.auditEvent.create(...); // 错：不属于 tx
});
```

必须让事务内的所有相关查询都使用 `tx`：

```ts
await this.database.$transaction(async (tx) => {
  const task = await tx.task.create(...);
  await tx.auditEvent.create(...);
});
```

另一个错误是吞掉异常：

```ts
await this.database.$transaction(async (tx) => {
  try {
    await tx.task.create(...);
    await tx.auditEvent.create(...);
  } catch {
    return undefined; // callback 正常返回，已完成的语句可能提交
  }
});
```

需要回滚时，让异常继续抛出。只有在你明确把某种失败转换成另一种异常时才 Catch，并再次 Throw。

## 12.6 先查再写仍然可能并发冲突

`OrganizationsService.addMember()` 先查询 Membership，再 Create，是为了友好提示；但两个并发请求仍可能都看到“不存在”。真正的正确性来自数据库 `@@unique([userId, organizationId])`。

后端并发设计通常分三层：

1. 应用预检查，给出可读错误；
2. Transaction 缩小竞态窗口并组合多写；
3. Unique/Foreign Key/Check/Version 等数据库约束最终守住事实。

不要把“我刚查过”当成并发证明。

## 12.7 事务隔离级别何时需要关注

普通 CRUD 使用数据库默认隔离通常足够；配额、余额、库存、唯一 Owner、结算等涉及“读当前值再决定写入”的流程，需要明确隔离与锁策略。例如扣减配额：

```sql
UPDATE quotas
SET remaining = remaining - 1
WHERE id = $1 AND remaining > 0;
```

用受条件保护的原子 Update，再检查影响行数，通常比“先 SELECT remaining，再 UPDATE”可靠。复杂流程可能需要 Serializable、`SELECT ... FOR UPDATE` 或可重试事务。选择前要写出并发不变量和死锁/重试策略。

---
