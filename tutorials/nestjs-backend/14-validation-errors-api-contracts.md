# 14. 输入校验、错误响应和 API 契约

> [返回教程首页](README.md)

## 14.1 当前项目使用 Zod 边界校验

示例：

```ts
const projectSchema = z.object({
  name: z.string().trim().min(1).max(200),
});

const { name } = projectSchema.parse(body);
```

必须校验：

- Body；
- Path Param；
- Query Param；
- Header；
- Cookie/外部回调；
- Worker Payload；
- 环境变量。

TypeScript 类型在运行时不存在，`body as CreateProjectInput` 不算校验。

## 14.2 不要直接暴露 Prisma Model

数据库模型是存储结构，API Response 是产品契约。直接返回实体在简单接口里方便，但长期应增加 Response Mapper/DTO，只输出允许字段，避免以后新增敏感列后意外泄漏。

例如：

```ts
return {
  id: project.id,
  name: project.name,
  createdAt: project.createdAt.toISOString(),
};
```

## 14.3 API 约定

项目文档要求：

- 资源 URL 使用复数；
- 只有父作用域必要时才嵌套；
- 列表最终使用游标分页 `{ data, nextCursor, meta? }`；
- 时间使用 ISO 8601 UTC；
- 金额用最小货币单位整数或十进制字符串；
- 错误使用 RFC 9457 Problem Details；
- 可重试写操作使用按租户、Actor、操作划分的幂等键；
- 并发编辑使用 version/ETag；
- 独立发布的公共 API 使用 `/v1`。

当前 Project 列表直接返回数组，这是一个可以练习升级为游标分页的地方。

## 14.4 Swagger 的当前边界

开发和测试环境在 `/docs` 生成 OpenAPI，但当前 Controller 使用 `unknown + Zod`，没有完整的 `@ApiBody`/Response DTO 元数据，因此 Swagger 页面未必能精确描述所有请求体和响应结构。

可选改进路线：

- 使用可生成 OpenAPI 的 Zod 集成；或
- 为公共 API 增加显式 Swagger DTO/Decorator；
- 在 CI 导出 OpenAPI 并做 Breaking Change 检查。

不要因为有 `/docs` 页面就默认契约一定完整。

## 14.5 常用 Zod 写法

```ts
const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().uuid().optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE']).optional(),
});

const updateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    status: z.enum(['TODO', 'IN_PROGRESS', 'DONE']).optional(),
  })
  .strict()
  .refine((value) => value.title !== undefined || value.status !== undefined, {
    message: 'At least one field must be provided.',
  });
```

- Query 参数都是字符串，数字常需要 `z.coerce.number()`；
- `.trim()` 之后再做 `min(1)`，防止全空格；
- `.strict()` 拒绝未知字段；Zod Object 默认会剥离未知键，要根据 API 策略明确选择；
- `.optional()` 是可省略；`.nullable()` 是允许显式 null，两者语义不同；
- 日期字符串先验证格式，再转换成 Date；响应统一序列化为 UTC ISO 字符串；
- Patch 必须拒绝空对象，否则客户端可能以为做了修改。

不要把数据库 Enum 的全部未来值自动暴露给旧客户端。API Enum 是契约，数据库 Enum 是存储事实，二者生命周期可能不同。

## 14.6 建立稳定应用错误码

当前 `ProblemDetailsFilter` 已能透传领域错误的可选 `code` 和 `retryAt`，并在有 `retryAt` 时生成 HTTP `Retry-After`。Profile 的昵称滚动配额就是例子：超过三次时返回 `429`、`NICKNAME_CHANGE_LIMIT` 和下一次允许时间。前端必须根据稳定 `code` 和时间字段渲染，而不是匹配自然语言 `detail`。

新增领域错误时可以定义：

```ts
export class ApplicationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

throw new ApplicationError(409, 'TASK_VERSION_CONFLICT', 'Task has changed.');
```

Filter 返回：

```json
{
  "type": "https://api.example.test/problems/task-version-conflict",
  "title": "Conflict",
  "status": 409,
  "code": "TASK_VERSION_CONFLICT",
  "detail": "Task has changed.",
  "instance": "/api/organizations/.../tasks/...",
  "requestId": "..."
}
```

前端根据 `code` 决定刷新或展示专用界面，文案可以国际化；不要根据英文 Detail 做字符串匹配。

## 14.7 Response Mapper 防止数据泄漏

给 Task 定义 Mapper：

```ts
function taskResponse(task: {
  id: string;
  projectId: string;
  title: string;
  status: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: task.id,
    projectId: task.projectId,
    title: task.title,
    status: task.status,
    version: task.version,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}
```

以后数据库新增 `internalRiskScore` 或软删除字段时，不会自动出现在 API。更重要的是，Controller/Mapper 让 API Contract 可独立于 ORM 演进。

## 14.8 可选重构：把重复 Zod Parse 变成 Pipe

当前写法很直观：

```ts
const { title } = createTaskSchema.parse(body);
```

如果 Route 很多，可以建立一个很小的 Pipe：

```ts
import { Injectable, type PipeTransform } from '@nestjs/common';
import { z } from 'zod';

@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: z.ZodType<T>) {}

  transform(value: unknown): T {
    return this.schema.parse(value);
  }
}
```

使用：

```ts
type CreateTaskInput = z.infer<typeof createTaskSchema>;

@Post()
create(
  @Body(new ZodValidationPipe(createTaskSchema)) body: CreateTaskInput,
) {
  return body.title;
}
```

ZodError 仍会被全局 `ProblemDetailsFilter` 捕获。进一步封装时要同时解决：

- Body、Query、Param 的不同 Schema；
- OpenAPI Schema 生成；
- 错误 Path 是否保留来源，例如 `body.title`；
- Transform 后的类型是否准确；
- 不要重复 Parse；
- Unit/E2E 是否仍覆盖 Filter 输出。

不要盲目同时启用 class-validator 全局 ValidationPipe 和 Zod，再让同一输入经历两套冲突规则。选择一套边界策略并保持一致。

## 14.9 API 幂等的具体设计

网络超时后，客户端不知道创建是否成功，可能重发 POST。对必须避免重复的操作，接受 `Idempotency-Key` Header，并在数据库存：

```text
organization_id
actor_id
operation
idempotency_key
normalized_request_hash
state (PROCESSING/SUCCEEDED/FAILED)
response_status
response_body
expires_at
```

规则：

1. 相同 Scope + Key + 相同 Request Hash：返回第一次结果；
2. 相同 Key + 不同 Payload：409；
3. 两个并发相同请求：唯一约束只允许一个执行；
4. 只有适合重放的最终响应才缓存；
5. 设置明确保留期和清理任务；
6. 不要把一个租户的 Key 和另一个租户共享；
7. 下游 Outbox Event 也使用稳定业务 ID 去重。

仅仅让客户端“自己保证不点两次”不是后端幂等设计。

---
