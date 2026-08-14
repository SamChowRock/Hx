# 11. 实战：新增一个 Tasks 业务模块

> [返回教程首页](../README.md) · [本模块目录](README.md)

本章带你为 Project 增加 Task。目标接口：

```text
GET  /api/organizations/:organizationId/projects/:projectId/tasks
POST /api/organizations/:organizationId/projects/:projectId/tasks
```

规则：

- 所有成员可以读取；
- OWNER、ADMIN、MEMBER 可以创建；
- VIEWER 不可创建；
- Project 必须属于 URL 中的 Organization；
- 创建 Task 必须记录审计日志；
- 标题长度 1～200；
- Controller 不直接访问 Prisma。

## 11.1 第一步：先写用例和权限表

在写代码前明确：

```text
输入：Actor、organizationId、projectId、title
前置条件：Actor 是该租户成员；角色允许创建；Project 属于该租户
成功结果：Task + AuditEvent 原子写入
失败：401 未登录、403 无角色、404 租户范围内找不到 Project、400 输入非法
```

在 `authorization.service.ts` 增加动作：

```ts
export type OrganizationAction = 'read' | 'create_project' | 'manage_tasks' | 'manage_members';

const permittedRoles: Record<OrganizationAction, OrganizationRole[]> = {
  read: ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'],
  create_project: ['OWNER', 'ADMIN', 'MEMBER'],
  manage_tasks: ['OWNER', 'ADMIN', 'MEMBER'],
  manage_members: ['OWNER', 'ADMIN'],
};
```

先给 `AuthorizationService` 增加测试：确认 MEMBER 允许、VIEWER 拒绝。

## 11.2 第二步：设计 Prisma 模型

在 `schema.prisma` 增加：

```prisma
enum TaskStatus {
  TODO
  IN_PROGRESS
  DONE
}

model Task {
  id        String     @id @default(uuid()) @db.Uuid
  projectId String     @map("project_id") @db.Uuid
  title     String
  status    TaskStatus @default(TODO)
  createdAt DateTime   @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime   @updatedAt @map("updated_at") @db.Timestamptz(6)
  project   Project    @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId, createdAt])
  @@map("tasks")
}
```

并在 `Project` 模型增加反向关系：

```prisma
tasks Task[]
```

创建并检查 Migration：

```bash
pnpm exec prisma migrate dev --name add_tasks
pnpm prisma:generate
git diff -- prisma/schema.prisma prisma/migrations
```

打开生成的 `migration.sql`，确认只有预期的 enum、table、foreign key 和 index。
