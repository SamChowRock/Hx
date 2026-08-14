# 4. 建立 NestJS 的核心心智模型

> [返回教程首页](README.md)

## 4.1 NestJS 不是“装饰器集合”

NestJS 最重要的价值是组织依赖与边界。可以先记住四个角色：

| 概念                  | 在本项目中的例子                          | 责任                                          |
| --------------------- | ----------------------------------------- | --------------------------------------------- |
| Module                | `ProjectsModule`                          | 声明一个功能边界，组装 Controller 和 Provider |
| Controller            | `ProjectsController`                      | 接收 HTTP 输入，处理协议细节，调用用例        |
| Provider/Service      | `ProjectsService`                         | 执行业务规则和数据库操作                      |
| Injectable dependency | `DatabaseService`、`AuthorizationService` | 被容器创建并注入给其他类                      |

最小模块如下：

```ts
@Module({
  imports: [AuthorizationModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
})
export class ProjectsModule {}
```

它表达了三件事：

1. 这个模块依赖 `AuthorizationModule` 导出的能力；
2. HTTP 请求由 `ProjectsController` 接收；
3. `ProjectsService` 由 Nest 容器创建，可以被本模块注入。

## 4.2 依赖注入如何发生

`ProjectsService` 没有自己 `new DatabaseService()`：

```ts
@Injectable()
export class ProjectsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorization: AuthorizationService,
  ) {}
}
```

Nest 根据构造函数类型找到 Provider 实例。这样做的价值是：

- 生命周期统一管理；
- 测试时容易替换成 Mock；
- 模块依赖清晰；
- 数据库连接不会被随意重复创建。

`DatabaseModule` 和 `EnvironmentModule` 使用了 `@Global()`，所以导入根模块后，其他模块通常不必反复导入。业务模块仍应显式导入非全局能力，例如 `AuthorizationModule`。

## 4.3 Controller 应该薄，Service 应该掌握业务

本项目的约定可以概括为：

```text
Controller：HTTP 协议、参数读取、输入校验、Cookie/Header
Service：权限策略调用、业务不变量、数据库事务、审计/Outbox
DatabaseService：Prisma 数据访问入口
```

不要在 Controller 中直接写 `database.project.create()`。否则 Worker、CLI 或将来的其他入口想复用业务时，只能复制逻辑，也容易绕过授权和审计。

## 4.4 Nest 生命周期在本项目中的应用

- `OnApplicationBootstrap`：Worker 启动轮询；
- `OnApplicationShutdown`：Worker 停止定时器并等待当前轮询结束；
- `enableShutdownHooks()`：让 SIGTERM 等信号触发清理；
- `DatabaseService.onApplicationShutdown()`：断开 Prisma 连接。

这对容器滚动发布很重要：进程不能收到停止信号就把正在投递的任务直接截断。

## 4.5 一个请求在 NestJS 内部经过什么

典型顺序可以简化为：

```text
Express Middleware
→ Guard
→ Interceptor（Controller 之前）
→ Pipe
→ Controller
→ Service/Provider
→ Interceptor（Controller 之后）
→ Response
```

发生异常时，Exception Filter 生成错误响应。

映射到当前项目：

| 阶段        | 当前实现                                                   |
| ----------- | ---------------------------------------------------------- |
| Middleware  | Helmet、认证接口 no-store、Cookie Parser、Pino HTTP Logger |
| Guard       | 全局 `ThrottlerGuard`                                      |
| Interceptor | `LoggerErrorInterceptor`                                   |
| Pipe        | 当前没有全局 DTO Pipe；Controller 内显式调用 Zod           |
| Controller  | Identity、Projects、Organizations、Health                  |
| Service     | IdentityService、AuthorizationService、ProjectsService 等  |
| Filter      | 全局 `ProblemDetailsFilter`                                |

为什么这个顺序重要？例如请求触发 429 时，它会在进入 Controller 前被 Guard 拒绝；Zod Parse 失败则发生在 Controller 内，随后被全局 Filter 捕获。

## 4.6 装饰器到底做了什么

装饰器给类和方法附加元数据，Nest 启动时读取这些元数据完成路由与依赖组装。

```ts
@Controller('projects')
export class ProjectsController {
  @Get(':id')
  findOne(@Param('id') id: string) {}
}
```

- `@Controller('projects')` 声明路由前缀；
- `@Get(':id')` 声明 GET Method 和路径；
- `@Param('id')` 从路径提取参数；
- `@Body()` 提取 JSON Body；
- `@Headers()` 提取 Header；
- `@Req()` 提供底层 Express Request；
- `@Res()` 提供底层 Response。

能让 Nest 自动返回时，优先直接 `return`：

```ts
@Get()
list() {
  return { data: [] };
}
```

只有设置/清除 Cookie、Redirect 等需要底层响应能力时才注入 Response。本项目常用：

```ts
@Res({ passthrough: true }) response: Response
```

`passthrough: true` 表示你可以操作 Cookie，但最终 JSON 仍交给 Nest 序列化。若使用裸 `@Res()`，就要自己 `response.redirect()` 或 `response.send()`，否则请求可能一直不结束。

Nest 默认让 `@Post()` 返回 201。本项目登录、登出、验证等不是“创建 REST 资源”的 POST 使用 `@HttpCode(HttpStatus.OK)` 改成 200；注册请求异步接受则返回 202。

## 4.7 Module 的可见性和 `exports`

Provider 默认只在声明它的 Module 内可见。`AuthorizationModule` 这样公开 Service：

```ts
@Module({
  imports: [IdentityModule],
  providers: [AuthorizationService],
  exports: [AuthorizationService],
})
export class AuthorizationModule {}
```

`ProjectsModule` 必须 `imports: [AuthorizationModule]` 才能注入 `AuthorizationService`。

常见报错：

```text
Nest can't resolve dependencies of the TasksService (..., ?)
```

排查顺序：

1. 目标类是否有 `@Injectable()`；
2. 它是否出现在所属 Module 的 `providers`；
3. 所属 Module 是否把它放进 `exports`；
4. 使用方 Module 是否放进 `imports`；
5. 是否产生循环依赖；
6. 注入 Token 和注册 Token 是否完全一致。

`DatabaseModule` 和 `EnvironmentModule` 是 `@Global()`，因此根模块导入一次后全局可见。不要把每个业务模块都做成 Global；全局依赖过多会隐藏模块关系并增加测试难度。

## 4.8 Provider 生命周期与状态

Nest Provider 默认是单例 Scope：一个应用上下文中通常只有一个实例。于是：

- `IdentityService.activePasswordOperations` 能在整个 API 进程限制 Argon2 并发；
- `WorkerService.pollPromise` 能避免同一进程内重叠轮询；
- 不应在单例 Service 字段中保存“当前用户”之类请求级数据；
- 横向扩容后每个进程各有一份内存状态，不能用它维护全局业务事实。

业务状态应进入 PostgreSQL；可丢失的加速状态才适合内存或 Cache。跨进程锁、计数和队列不能靠一个类字段完成。

---
