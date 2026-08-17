# 5. 读懂项目目录与模块边界

> [返回教程首页](README.md)

```text
apps/
  api/src/
    main.ts                    # API 进程入口
    app.module.ts              # API 根模块
    configure-application.ts   # Helmet、Cookie、错误过滤器、/api 前缀
    identity/                  # 注册、Session、密码、OIDC、微信 OAuth
    authorization/             # ActorContext、RBAC、多租户授权
    profile/                   # 本人 Profile、字段隐私、头像处理与私有对象存储
    notifications/             # 站内收件箱、SSE 与通知 HTTP 边界
    organizations/             # 成员读取与添加
    projects/                  # Project 示例业务
    health/                    # liveness / readiness
    http/                      # HTTP 安全和统一错误
  worker/src/
    main.ts                    # Worker 进程入口，不启动 HTTP Server
    worker.module.ts
    worker.service.ts          # Outbox 领取、重试、邮件/SMS 投递
libs/
  platform/src/
    config/                    # Zod 环境变量校验和 Provider
    database/                  # Prisma Client 封装及生成代码
    notifications/             # 通知输入/Outbox Payload 的共享 Zod 契约
prisma/
  schema.prisma               # 数据模型唯一主要定义
  migrations/                 # 版本化 SQL Migration
test/
  *.e2e-spec.ts               # 真实 Nest 应用 + PostgreSQL E2E
docs/
  adr/                        # 架构决策记录
  API_CONVENTIONS.md          # API 契约规范
  THREAT_MODEL.md             # 威胁模型
```

## 5.1 为什么 API 和 Worker 分开入口

API 使用：

```ts
NestFactory.create(AppModule);
```

它创建 HTTP 应用并监听端口。Worker 使用：

```ts
NestFactory.createApplicationContext(WorkerModule);
```

它只创建依赖注入容器，不开启 HTTP 服务。二者可以使用相同的配置和数据库基础设施，但运行职责不同：

- API 应尽快完成请求；
- Worker 负责邮件、短信等可重试的后台副作用；
- API 变忙时可单独扩 API；
- 投递积压时可单独扩 Worker。

## 5.2 模块边界的判断方法

新增代码前问三个问题：

1. 它属于哪个业务能力，而不是哪个技术层？
2. 其他模块需要调用它的公开 Service 吗？
3. 它是否需要独立的 Controller、数据模型或后台消费者？

例如“给项目新增任务”应放到 `tasks` 功能模块；不要创建一个包罗所有数据库操作的 `CommonService`。

`profile/` 是另一个好例子：`ProfileController` 只负责 Cookie、Origin、CSRF、Multipart 和 HTTP 缓存 Header；`ProfileService` 负责本人/他人可见性、行锁、昵称配额和审计；`AvatarStorageService` 是唯一接触 S3/MinIO 的基础设施适配器。把三者混成 Controller 会让隐私规则和失败清理难以测试。

## 5.3 阅读陌生模块的固定方法

以后接手其他 NestJS 项目，也可以按以下顺序读：

1. 看 Module：它依赖谁、公开谁；
2. 看 Controller：有哪些入口、输入和状态码；
3. 看 Service 的公开方法：有哪些用例；
4. 看 Prisma Model：数据事实和约束；
5. 看 Unit Test：作者认为哪些规则重要；
6. 看 E2E：客户端真正看到的契约；
7. 看 ADR/Threat Model：为什么这样设计。

以 `projects` 为例，你应能写出：

```text
ProjectsModule
  imports AuthorizationModule
  owns ProjectsController + ProjectsService

GET list
  Session → Actor → read permission → tenant-scoped findMany

POST create
  Origin → Session → CSRF → create_project permission
  → transaction(Project + AuditEvent)
```

如果读完代码却不能画出这张小图，说明你看到的是语法，还没有抓到业务链路。

## 5.4 为什么当前目录还不是最终形态

现在每个功能目录只有 Controller、Service、Module，适合当前规模。随着模块变大，可以在模块内部逐步拆为：

```text
tasks/
  api/
    tasks.controller.ts
    task.schemas.ts
    task.response.ts
  application/
    create-task.use-case.ts
    list-tasks.use-case.ts
  domain/
    task-policy.ts
  infrastructure/
    prisma-task.repository.ts
  tasks.module.ts
```

拆层的触发条件应该是复杂度：多个用例、复杂领域规则、多个入口或需要替换基础设施。不要只有一个 30 行 Service 时就建立十几个空目录。

---
