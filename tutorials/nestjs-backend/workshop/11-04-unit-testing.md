# TasksService 单元测试

> [返回教程首页](../README.md) · [本模块目录](README.md)

## 11.9 第九步：给 TasksService 写单元测试

新建 `apps/api/src/tasks/tasks.service.spec.ts`。下面的测试不连接数据库，重点验证 Service 如何组合授权、租户查询、事务和审计：

```ts
import { NotFoundException } from '@nestjs/common';

import type { ActorContext } from '../authorization/authorization.service';
import { TasksService } from './tasks.service';

describe('TasksService', () => {
  const actor: ActorContext = {
    userId: '00000000-0000-0000-0000-000000000011',
    sessionId: '00000000-0000-0000-0000-000000000021',
    sessionSecret: 'session-secret',
    csrfSecretHash: 'csrf-hash',
  };
  const organizationId = '00000000-0000-0000-0000-000000000001';
  const projectId = '00000000-0000-0000-0000-000000000002';

  const authorization = {
    requireOrganizationAction: jest.fn(),
  };
  const tx = {
    project: { findFirst: jest.fn() },
    task: { create: jest.fn() },
    auditEvent: { create: jest.fn() },
  };
  const database = {
    project: { findFirst: jest.fn() },
    task: { findMany: jest.fn() },
    $transaction: jest.fn(async (operation: (client: typeof tx) => Promise<unknown>) =>
      operation(tx),
    ),
  };

  const service = new TasksService(database as never, authorization as never);

  beforeEach(() => {
    jest.clearAllMocks();
    authorization.requireOrganizationAction.mockResolvedValue({ role: 'MEMBER' });
  });

  it('lists tasks only after checking action and scoped project', async () => {
    database.project.findFirst.mockResolvedValue({ id: projectId });
    database.task.findMany.mockResolvedValue([{ id: 'task-1', title: 'Learn NestJS' }]);

    await expect(service.list(actor, organizationId, projectId)).resolves.toEqual([
      { id: 'task-1', title: 'Learn NestJS' },
    ]);

    expect(authorization.requireOrganizationAction).toHaveBeenCalledWith(
      actor,
      organizationId,
      'read',
    );
    expect(database.project.findFirst).toHaveBeenCalledWith({
      where: { id: projectId, organizationId },
      select: { id: true },
    });
    expect(database.task.findMany).toHaveBeenCalledWith({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('creates a task and audit event in one transaction', async () => {
    tx.project.findFirst.mockResolvedValue({ id: projectId });
    tx.task.create.mockResolvedValue({ id: 'task-1', projectId, title: 'Learn NestJS' });
    tx.auditEvent.create.mockResolvedValue({ id: 'audit-1' });

    await expect(service.create(actor, organizationId, projectId, 'Learn NestJS')).resolves.toEqual(
      { id: 'task-1', projectId, title: 'Learn NestJS' },
    );

    expect(authorization.requireOrganizationAction).toHaveBeenCalledWith(
      actor,
      organizationId,
      'manage_tasks',
    );
    expect(tx.task.create).toHaveBeenCalledWith({
      data: { projectId, title: 'Learn NestJS' },
    });
    expect(tx.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorUserId: actor.userId,
        organizationId,
        action: 'task.created',
        targetType: 'task',
        targetId: 'task-1',
      },
    });
  });

  it('does not create when the project is outside the organization scope', async () => {
    tx.project.findFirst.mockResolvedValue(null);

    await expect(
      service.create(actor, organizationId, projectId, 'Cross-tenant attempt'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(tx.task.create).not.toHaveBeenCalled();
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });
});
```

这个测试的局限也要看见：Mock Transaction 不会证明 PostgreSQL 真能回滚，Relation 和 Prisma 参数也可能被 Mock 掩盖。所以还需要 E2E。
