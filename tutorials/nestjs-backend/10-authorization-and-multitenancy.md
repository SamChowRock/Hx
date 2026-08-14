# 10. 掌握授权与多租户：用户能做什么

> [返回教程首页](README.md)

## 10.1 `ActorContext`

`AuthorizationService.actorFromSession()` 把 Cookie Secret 转成：

```ts
type ActorContext = {
  userId: string;
  sessionId: string;
  sessionSecret: string;
  csrfSecretHash: string;
};
```

业务 Service 接收 Actor，而不是直接接收一个用户声称的 `userId`。

## 10.2 当前角色矩阵

| 动作             | OWNER | ADMIN | MEMBER | VIEWER |
| ---------------- | :---: | :---: | :----: | :----: |
| `read`           |  ✅   |  ✅   |   ✅   |   ✅   |
| `create_project` |  ✅   |  ✅   |   ✅   |   ❌   |
| `manage_members` |  ✅   |  ✅   |   ❌   |   ❌   |

角色矩阵集中在 `authorization.service.ts`：

```ts
const permittedRoles: Record<OrganizationAction, OrganizationRole[]> = {
  read: ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'],
  create_project: ['OWNER', 'ADMIN', 'MEMBER'],
  manage_members: ['OWNER', 'ADMIN'],
};
```

不要把这种规则散落成十几个 Controller 中的 `if (role === ...)`。

## 10.3 多租户最重要的规则

客户端传来的 `organizationId` 只是“请求访问哪个租户”，绝不是授权证明。每个租户资源操作都必须：

1. 从可信 Session 得到 Actor；
2. 查询该 Actor 在目标 Organization 的 Membership；
3. 检查动作需要的角色；
4. 数据库查询始终带租户范围；
5. Worker Job 也重新验证租户/系统 Actor，而不是信任 Payload。

安全查询：

```ts
await database.project.findMany({ where: { organizationId } });
```

危险查询：

```ts
await database.project.findUnique({ where: { id: projectId } });
// 随后直接返回；没有证明该 Project 属于已授权 organizationId
```

## 10.4 为什么不能只靠 Guard

Guard 可以提前拒绝明显非法的 HTTP 请求，但业务 Service 才是权威策略点。原因是同一个用例未来可能从 Worker、CLI 或内部调用触发，它们没有 HTTP Guard。

本项目的 `ProjectsService` 在自身方法中再次调用 `requireOrganizationAction()`，这是值得保留的安全边界。

## 10.5 一次授权决策的标准步骤

处理任何租户资源时按顺序问：

1. **Actor 是谁？** 从 Session/机器身份得到，不从 Body 得到；
2. **Tenant 是谁？** 请求想操作哪个 Organization；
3. **Action 是什么？** 用稳定动作名，而不是模糊的“有权限”；
4. **Role 允许吗？** Membership Role 是否在策略矩阵；
5. **Resource 属于 Tenant 吗？** 查询同时带资源 ID 和 Tenant Scope；
6. **Resource 当前状态允许吗？** 例如 DONE Task 是否允许修改；
7. **是否需要 Step-up？** 导出、改 OWNER 等高风险操作可能要求重新认证/MFA；
8. **是否记录 Audit？** 安全敏感操作通常需要。

角色只能回答一部分问题。例如 MEMBER 可以管理 Task，不代表能修改任意租户的 Task，也不代表能修改已归档 Project 下的 Task。

## 10.6 用攻击者视角写测试

对每个资源至少想象：

- 把 Organization ID 换成另一个租户；
- 保持 Organization A，但传入 Project B 的 ID；
- Viewer 重放 Owner 的请求 Body；
- 使用已撤销/过期 Session；
- 使用 Session A 的 Cookie + Session B 的 CSRF；
- 删除 Origin 或伪造 Evil Origin；
- 并发发送两个相同创建请求；
- 猜测一个真实存在但无权访问的 UUID。

对无权访问的资源返回 404 还是 403是产品与安全决策：

- Membership 本身不允许：本项目返回 403；
- 已通过组织授权，但传入不属于该组织的 Project：按租户范围查询后返回 404，避免泄漏其他租户资源存在性。

## 10.7 `OWNER` 不是普通可随意修改的角色

当前成员添加接口禁止创建新的 OWNER，只允许 ADMIN/MEMBER/VIEWER。这暗示 OWNER 转移应是专门的高风险用例，至少考虑：

- 组织必须始终有 Owner；
- 不能把最后一个 Owner 降级或移除；
- 可能要求近期重新认证或 MFA；
- 转移与双方通知；
- 完整审计；
- 并发下用事务/锁守住“至少一个 Owner”。

不要简单地把 `OWNER` 加进 `memberSchema` 枚举就认为功能完成。

## 10.8 可选重构：Session Guard 与 `@CurrentActor`

当前 Projects、Organizations、Tasks Controller 都会重复读取 Session Cookie。模块增多后，可以把“认证”提取为 Nest Guard，但资源级授权仍保留在 Service。

先扩展 Request 类型：

```ts
import type { Request } from 'express';
import type { ActorContext } from './authorization.service';

export type AuthenticatedRequest = Request & {
  actor: ActorContext;
};
```

实现 Guard：

```ts
import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';

import { ENVIRONMENT, type Environment } from '../../../../libs/platform/src/config';
import { readAuthCookie } from '../http/auth-http';
import { AuthorizationService } from './authorization.service';
import type { AuthenticatedRequest } from './authenticated-request';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly authorization: AuthorizationService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const secret = readAuthCookie(request, this.environment, 'session') ?? '';
    request.actor = await this.authorization.actorFromSession(secret, this.environment.AUTH_SECRET);
    return true;
  }
}
```

实现参数装饰器：

```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from './authenticated-request';

export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().actor,
);
```

在 `AuthorizationModule` 注册并导出 Guard，在 Controller 使用：

```ts
@Controller('organizations/:organizationId/projects')
@UseGuards(SessionAuthGuard)
export class ProjectsController {
  @Get()
  list(@CurrentActor() actor: ActorContext, @Param('organizationId') organizationId: string) {
    return this.projects.list(actor, z.string().uuid().parse(organizationId));
  }
}
```

这项重构的边界：

- Guard 负责建立身份 Actor；
- Controller 仍负责 Origin、CSRF 和 HTTP 参数；
- Service 仍负责 `requireOrganizationAction()` 与资源 Scope；
- Worker/CLI 仍必须通过自己的可信身份构造 Actor；
- 不要把所有角色和资源查询塞进一个庞大全局 Guard。

在当前小项目里保留显式 `actor()` 也合理。重构应减少真实重复，而不是为了使用更多 Nest 特性。

---
