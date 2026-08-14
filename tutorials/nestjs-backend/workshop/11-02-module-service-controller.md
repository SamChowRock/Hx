# Tasks Module、Service 与 Controller

> [返回教程首页](../README.md) · [本模块目录](README.md)

## 11.3 第三步：创建模块

新增 `apps/api/src/tasks/tasks.module.ts`：

```ts
import { Module } from '@nestjs/common';

import { AuthorizationModule } from '../authorization/authorization.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [AuthorizationModule],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
```

## 11.4 第四步：实现 Service

新增 `apps/api/src/tasks/tasks.service.ts`：

```ts
import { Injectable, NotFoundException } from '@nestjs/common';

import { DatabaseService } from '../../../../libs/platform/src/database';
import { type ActorContext, AuthorizationService } from '../authorization/authorization.service';

@Injectable()
export class TasksService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
  ) {}

  async list(actor: ActorContext, organizationId: string, projectId: string) {
    await this.authorization.requireOrganizationAction(actor, organizationId, 'read');
    await this.requireScopedProject(organizationId, projectId);

    return this.database.task.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(actor: ActorContext, organizationId: string, projectId: string, title: string) {
    await this.authorization.requireOrganizationAction(actor, organizationId, 'manage_tasks');

    return this.database.$transaction(async (tx) => {
      const project = await tx.project.findFirst({
        where: { id: projectId, organizationId },
        select: { id: true },
      });
      if (!project) throw new NotFoundException('Project was not found.');

      const task = await tx.task.create({ data: { projectId, title } });
      await tx.auditEvent.create({
        data: {
          actorUserId: actor.userId,
          organizationId,
          action: 'task.created',
          targetType: 'task',
          targetId: task.id,
        },
      });
      return task;
    });
  }

  private async requireScopedProject(organizationId: string, projectId: string): Promise<void> {
    const project = await this.database.project.findFirst({
      where: { id: projectId, organizationId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Project was not found.');
  }
}
```

注意三个细节：

1. 权限检查发生在 Service，不只在 HTTP 层；
2. 查 Project 时同时带 `id` 和 `organizationId`，避免跨租户 IDOR；
3. 创建 Task 与 AuditEvent 在同一事务中。

## 11.5 第五步：实现 Controller

新增 `apps/api/src/tasks/tasks.controller.ts`：

```ts
import { Body, Controller, Get, Headers, Inject, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';

import { ENVIRONMENT, type Environment } from '../../../../libs/platform/src/config';
import { AuthorizationService } from '../authorization/authorization.service';
import { assertAllowedOrigin, readAuthCookie } from '../http/auth-http';
import { TasksService } from './tasks.service';

const uuidSchema = z.string().uuid();
const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
});

@Controller('organizations/:organizationId/projects/:projectId/tasks')
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly authorization: AuthorizationService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  private async actor(request: Request) {
    const secret = readAuthCookie(request, this.environment, 'session');
    return this.authorization.actorFromSession(secret ?? '', this.environment.AUTH_SECRET);
  }

  @Get()
  async list(
    @Req() request: Request,
    @Param('organizationId') rawOrganizationId: string,
    @Param('projectId') rawProjectId: string,
  ) {
    const organizationId = uuidSchema.parse(rawOrganizationId);
    const projectId = uuidSchema.parse(rawProjectId);
    return this.tasks.list(await this.actor(request), organizationId, projectId);
  }

  @Post()
  async create(
    @Req() request: Request,
    @Param('organizationId') rawOrganizationId: string,
    @Param('projectId') rawProjectId: string,
    @Headers('x-csrf-token') csrf: string | undefined,
    @Body() body: unknown,
  ) {
    assertAllowedOrigin(request, this.environment);
    const organizationId = uuidSchema.parse(rawOrganizationId);
    const projectId = uuidSchema.parse(rawProjectId);
    const actor = await this.actor(request);
    this.authorization.assertCsrf(actor, csrf, this.environment.AUTH_SECRET);
    const { title } = createTaskSchema.parse(body);
    return this.tasks.create(actor, organizationId, projectId, title);
  }
}
```

## 11.6 第六步：接入根模块

在 `AppModule` 中：

```ts
import { TasksModule } from './tasks/tasks.module';

@Module({
  imports: [
    // ...
    TasksModule,
  ],
})
export class AppModule {}
```

如果忘记导入，代码可以存在且能被 TypeScript 编译，但路由不会注册。
