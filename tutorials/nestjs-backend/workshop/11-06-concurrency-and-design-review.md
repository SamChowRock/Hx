# 乐观锁、设计评审与批量需求

> [返回教程首页](../README.md) · [本模块目录](README.md)

## 11.11 进阶：实现带乐观锁的 Task 状态更新

先给 `Task` 增加：

```prisma
version Int @default(1)
```

创建 Migration 后定义请求：

```ts
const updateTaskSchema = z.object({
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE']),
  version: z.number().int().positive(),
});
```

增加路由：

```ts
@Patch(':taskId')
async update(
  @Req() request: Request,
  @Param('organizationId') rawOrganizationId: string,
  @Param('projectId') rawProjectId: string,
  @Param('taskId') rawTaskId: string,
  @Headers('x-csrf-token') csrf: string | undefined,
  @Body() body: unknown,
) {
  assertAllowedOrigin(request, this.environment);
  const organizationId = uuidSchema.parse(rawOrganizationId);
  const projectId = uuidSchema.parse(rawProjectId);
  const taskId = uuidSchema.parse(rawTaskId);
  const actor = await this.actor(request);
  this.authorization.assertCsrf(actor, csrf, this.environment.AUTH_SECRET);
  const input = updateTaskSchema.parse(body);
  return this.tasks.updateStatus(actor, organizationId, projectId, taskId, input);
}
```

记得从 `@nestjs/common` 导入 `Patch`。Service 方法：

```ts
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { TaskStatus } from '../../../../libs/platform/src/database/generated/client';

async updateStatus(
  actor: ActorContext,
  organizationId: string,
  projectId: string,
  taskId: string,
  input: { status: TaskStatus; version: number },
) {
  await this.authorization.requireOrganizationAction(actor, organizationId, 'manage_tasks');

  return this.database.$transaction(async (tx) => {
    const scopedTask = await tx.task.findFirst({
      where: {
        id: taskId,
        projectId,
        project: { organizationId },
      },
      select: { id: true },
    });
    if (!scopedTask) throw new NotFoundException('Task was not found.');

    const updated = await tx.task.updateMany({
      where: { id: taskId, version: input.version },
      data: {
        status: input.status,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException('Task was changed by another request.');
    }

    const task = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
    await tx.auditEvent.create({
      data: {
        actorUserId: actor.userId,
        organizationId,
        action: 'task.status_changed',
        targetType: 'task',
        targetId: task.id,
      },
    });
    return task;
  });
}
```

并发场景：客户端 A、B 都读取到 version 1。A 更新成功，数据库变成 version 2；B 仍提交 version 1，`updateMany.count` 为 0，返回 409。B 必须刷新后再决定，而不是静默覆盖 A。

至少增加两个测试：

- version 1 更新成功，响应 version 2；
- 再次用 version 1 返回 409，数据库仍保留第一次结果。

## 11.12 回头做一次设计评审：每个选择为什么存在

### 为什么 Route 嵌套 Organization 和 Project

```text
/organizations/:organizationId/projects/:projectId/tasks
```

Task 的授权必须依赖 Organization，Project 又是 Task 的直接父资源。嵌套 Route 让 Tenant Scope 显式。但嵌套过深也会增加客户端和 Controller 复杂度；如果 Task ID 全局唯一且所有用例都能从 Task 推导 Tenant，也可以设计 `/tasks/:taskId`，随后在数据库查询中 Join Project 校验 Tenant。选择标准是授权 Scope 是否必要，而不是所有关系都体现在 URL。

### 为什么 Task 表只存 `projectId`，不重复存 `organizationId`

Organization 可通过 Task → Project 唯一推导。少存一列避免两个 Tenant ID 不一致：

```text
task.organizationId = A
task.project.organizationId = B
```

代价是某些 Tenant 查询需要 Join。如果任务量和查询证明直接 `organizationId` 很有价值，可以反规范化，但必须用复合 Foreign Key/触发器/写路径保证两列一致，而不是随手复制。

### 为什么权限动作叫 `manage_tasks`，而不是检查 `role !== VIEWER`

Action 表达业务能力，Role 只是当前授予能力的方式。以后可能出现自定义角色、Resource Owner 或 Project 状态规则，Service 仍请求“manage tasks”，不用知道具体 Role 组合。

### 为什么先校验 Membership，再查 Project Scope

- 非成员直接 403，明确无组织权限；
- 已是成员但 Project 不属于该组织时返回 404，避免泄漏另一个组织资源；
- 所有数据库查询都用服务端验证过的 Organization Scope。

这是一种有意的错误语义，不只是查询顺序。

### 为什么创建时在事务里再次查 Project

List 中先查 Project 再查 Task 足够用于读取；Create 把 Project Scope Check、Task Insert 和 Audit 放在一个 Transaction 内，使关键写路径靠近一致性边界。如果 Project 同时可能被删除/归档，还需根据数据库隔离和 Foreign Key/状态条件进一步设计。

### 为什么审计与 Task 同事务

需求把 `task.created` 视为必须留痕的安全/业务事实。如果允许 Task 成功但 Audit 失败，事后无法可靠追责。若审计仅是低价值分析事件，可能改为 Outbox 异步，但那是不同的业务要求。

### 为什么通知不在 Controller 中发送

Controller 返回前不需要等待邮件；Provider 不可靠；重复请求可能重复通知。因此 Service 应在创建事务里写最小 Outbox Event，由幂等 Worker 处理。

### 为什么要同时写 Unit 和 E2E

- Unit 快速穷举权限、分支和调用意图；
- E2E 证明 Module 接线、Cookie、CSRF、Filter、Prisma、Foreign Key、Transaction 和真实响应共同工作；
- 两者保护的风险不同，不能互相完全替代。

## 11.13 如果需求改成“批量创建 1000 个 Task”会怎样

不要简单在 Controller 中循环调用 1000 次 `create()`：

- 1000 次权限查询；
- 1000 个 Transaction；
- 1000 个 Audit/通知；
- 请求可能超时，但部分已经成功；
- 重试可能重复；
- Body 和数据库压力不可控。

设计前要问：

```text
必须全成功或全失败吗？
允许部分成功并返回逐项结果吗？
是否应该上传文件并异步导入？
最大批量是多少？
如何幂等和恢复？
Audit 是每项还是一次批量事件？
用户如何查看进度和失败行？
```

小批量且必须原子，可以单 Transaction + `createMany`，但要限制数量和事务时长；大批量通常创建 Import Job，Worker 分批处理，记录进度、错误和幂等键。接口数量不是唯一变化，失败模型已经改变。

---
