# NestJS 后端研发教程

> 面向有经验的前端研发：简略带过 JavaScript/TypeScript，重点学习后端设计、数据库、并发、可靠性、安全和运维。

这套教程独立放在 `tutorials/nestjs-backend/`，不与项目 ADR、威胁模型和 API 规范等技术文档混放。每一册只解决一个主题；不需要一次读完整套内容。

## 推荐阅读方式

### 路线 A：先建立后端思维

适合第一次接触后端设计：

1. [项目与技术栈全景](01-overview-and-stack.md)
2. [后端核心思维模块](mindset/README.md)
3. [项目结构与模块边界](05-project-structure.md)
4. [跟踪一次真实 HTTP 请求](07-request-lifecycle.md)
5. [PostgreSQL 与 Prisma](08-prisma-and-postgresql.md)

### 路线 B：边做边学

适合希望尽快完成第一个功能：

1. [本地开发环境](03-local-development.md)
2. [NestJS 核心心智模型](04-nestjs-mental-model.md)
3. [启动、全局配置与环境变量](06-bootstrap-and-config.md)
4. [认证](09-authentication.md)
5. [用户 Profile：隐私、并发配额与私有头像](profiles/README.md)
6. [授权与多租户](10-authorization-and-multitenancy.md)
7. [站内通知：Outbox、幂等收件箱与 SSE](notifications/README.md)
8. [Tasks 完整实战](workshop/README.md)
9. [测试](15-testing.md)

### 路线 C：补齐生产级后端能力

适合已经能写 CRUD，希望理解“为什么生产系统更复杂”：

1. [事务、审计与一致性](12-transactions-audit-consistency.md)
2. [Outbox、Worker、Queue 与 Cache](13-outbox-workers-and-cache.md)
3. [校验、错误和 API 契约](14-validation-errors-api-contracts.md)
4. [日志、健康检查与排错](16-observability-and-debugging.md)
5. [构建、部署、SLO 与容量](17-build-deploy-operations.md)
6. [初创项目的低运维生产方案：大陆与海外](deployment/README.md)
7. [研发工作流与设计文档](18-development-workflow-and-design.md)
8. [安全与反模式](19-security-and-antipatterns.md)

### 路线 D：从“能独立开发”到专家训练

完成基础教程和 Tasks 实战后，进入独立的训练路线：

- [专家训练总目录](expert-track/README.md)

这条路线不以阅读完成为目标，而要求真实代码改造、并发复现、故障注入、查询计划、事故演练、毕业项目和答辩评审。

### 路线 E：深入 Docker 与 PostgreSQL

适合已经能启动本项目，但希望真正理解容器运行、数据库内部原理和生产恢复：

1. [Docker 与 PostgreSQL 深度模块总目录](infrastructure/README.md)
2. Docker 镜像、容器、文件系统、网络和安全边界
3. PostgreSQL 建模、SQL、索引、执行计划、MVCC、事务和锁
4. 连接池、监控、备份、PITR、复制、故障切换和恢复演练
5. Prisma 与 PostgreSQL 的职责边界
6. 11 个综合实验与生产设计毕业项目

这条路线强调“预测行为—制造现象—收集证据—完成恢复”，不能用只阅读概念代替实验。

## 完整目录

### 第一部分：认识系统

- [01｜项目、架构和技术选型](01-overview-and-stack.md)
- [02｜前端研发转后端：核心思维（分为 5 册）](mindset/README.md)

### 第二部分：NestJS 与本地开发

- [03｜搭建本地开发环境](03-local-development.md)
- [04｜NestJS 的核心心智模型](04-nestjs-mental-model.md)
- [05｜项目目录与模块边界](05-project-structure.md)
- [06｜API 启动、全局配置和环境变量](06-bootstrap-and-config.md)
- [07｜一次 HTTP 请求的完整生命周期](07-request-lifecycle.md)

### 第三部分：数据与安全边界

- [08｜Prisma 与 PostgreSQL](08-prisma-and-postgresql.md)
- [09｜认证：Cookie Session、OIDC、微信扫码与密码安全](09-authentication.md)
- [09A｜认证专题：微信开放平台网站扫码 OAuth](authentication/README.md)
- [10｜授权、RBAC 与多租户隔离](10-authorization-and-multitenancy.md)
- [10A｜用户 Profile 专题：隐私、并发配额与私有头像](profiles/README.md)
- [10B｜站内通知专题：Outbox、幂等收件箱与 SSE](notifications/README.md)

### 第四部分：完整业务研发

- [11｜Tasks 业务模块实战（分为 6 册）](workshop/README.md)
- [12｜事务、审计日志与一致性](12-transactions-audit-consistency.md)
- [13｜异步任务、Outbox、Worker 与 Cache](13-outbox-workers-and-cache.md)
- [14｜输入校验、错误响应和 API 契约](14-validation-errors-api-contracts.md)
- [15｜单元测试与 E2E](15-testing.md)

### 第五部分：生产化与工程方法

- [16｜日志、健康检查与排错](16-observability-and-debugging.md)
- [17｜构建、容器化、部署与容量设计](17-build-deploy-operations.md)
- [17A｜初创项目的低运维生产方案：大陆与海外](deployment/README.md)
- [18｜日常研发工作流与功能设计](18-development-workflow-and-design.md)
- [19｜安全问题与常见反模式](19-security-and-antipatterns.md)

### 练习与速查

- [20｜进阶练习与能力地图](20-advanced-exercises.md)
- [21｜命令速查](21-command-reference.md)
- [22｜现有 API 与源码阅读地图](22-project-reference.md)

### 基础设施与数据库深度训练

- [Docker 与 PostgreSQL：11 册原理、运维与故障实验](infrastructure/README.md)

### 教程维护

- [代码变化后如何更新教程](maintenance/README.md)
- [当前项目自动生成的事实快照](generated/README.md)
- [教程语义审查清单](maintenance/review-checklist.md)

### 专家训练

- [后端专家训练路线：13 个实验与毕业项目](expert-track/README.md)

## 降低阅读负担的建议

- 每次只读一册，并完成其中一个实验；
- 先预测系统行为，再运行命令或测试验证；
- 每个功能至少保留一次成功、一次安全拒绝和一次数据库结果证据；
- 遇到不理解的设计，先问“它保护了哪个不变量、失败时如何恢复”；
- `21` 和 `22` 是参考手册，不需要顺序阅读。

教程基线：2026-08-14，仓库 `main` 分支提交 `145ba46`。
