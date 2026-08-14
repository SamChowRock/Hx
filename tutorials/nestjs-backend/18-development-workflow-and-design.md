# 18. 日常研发工作流

> [返回教程首页](README.md)

## 18.1 接到需求后

先写一页最小设计：

1. 用户场景与验收条件；
2. 资源属于哪个 Organization；
3. 哪些角色能执行哪些动作；
4. 输入、输出、状态码和错误码；
5. 数据模型、唯一约束、外键和索引；
6. 哪些写入必须同一事务；
7. 是否需要审计；
8. 是否有非即时副作用，需要 Outbox；
9. 是否需要幂等和并发控制；
10. 单元测试和 E2E 的拒绝路径。

## 18.2 推荐实现顺序

```text
验收条件
→ 权限动作/策略测试
→ Prisma Schema 和 Migration
→ Service 用例
→ Controller 协议层
→ Module 接线
→ 单元测试
→ E2E 测试
→ 日志/审计/Outbox
→ 文档/OpenAPI
→ 全量质量检查
```

先做 Service，可以让你围绕业务不变量思考；Controller 只是把 HTTP 输入转换成用例参数。

## 18.3 提交前检查

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose config --quiet
```

涉及数据库或 HTTP 主链路时再运行：

```bash
docker compose up --detach --wait postgres
pnpm prisma:migrate:deploy
pnpm test:e2e
```

涉及容器时运行：

```bash
docker compose build migration api worker
```

## 18.4 Code Review 自检

- Controller 是否只处理 HTTP 边界？
- Service 是否执行权威授权？
- 每个租户查询是否带 Organization Scope？
- 运行时输入是否经过 Zod？
- 是否暴露了 Prisma/Provider 原始错误？
- 多写操作是否需要事务？
- 重要动作是否有审计？
- 外部副作用是否错误地发生在事务/请求内？
- 重试是否幂等且有上限？
- 日志是否包含 Secret/PII？
- Migration 是否向前兼容并有索引？
- E2E 是否覆盖跨租户和低权限角色？

## 18.5 一个可复用的后端设计文档模板

```markdown
# Feature: <名称>

# Context / User outcome

用户想完成什么？当前问题是什么？

# Non-goals

本次明确不解决什么，避免范围无限扩大。

# API contract

Method、Path、Request、Response、状态码、错误码、幂等语义、分页。

# Actor / Tenant / Policy

谁发起？作用于哪个租户/资源？哪些动作和角色？

# Data model

表、字段、关系、状态机、Unique、Foreign Key、Check、Index、保留/删除。

# Invariants

任何并发与失败下都必须成立的事实。

# Transaction boundary

哪些写必须一起提交？隔离/版本/锁策略是什么？

# Synchronous vs asynchronous

响应前必须成立什么？哪些走 Outbox/Job？

# Failure and retry

Timeout、重试、幂等、部分失败、Dead/补偿/人工处理。

# Security and privacy

不可信输入、越权、枚举、CSRF、SSRF、Secret/PII、审计。

# Observability and operations

日志字段、指标、告警、Dashboard、重放/修复、Runbook。

# Migration / rollout / rollback

新旧版本兼容、Backfill、Feature Flag、回滚限制。

# Test plan

Unit、Integration/E2E、拒绝路径、跨租户、并发、故障注入。

# Alternatives and reconsideration

为什么不选其他方案？什么证据出现时重评？
```

这份模板不要求每个小 CRUD 写十页。简单功能每项一两句即可；敏感功能应详细到评审者能指出失败模型。

## 18.6 设计演练：邀请尚未注册的用户加入 Organization

当前 `OrganizationsService.addMember()` 只能通过已验证邮箱找到 Active User，然后直接创建 Membership。现在产品提出：“管理员可以邀请尚未注册的人”。先不要写 Controller，先设计。

### 澄清产品语义

- OWNER/ADMIN 可以邀请；
- 只能邀请 ADMIN/MEMBER/VIEWER，不能邀请 OWNER；
- 邀请 7 天过期；
- 同一邮箱在同一 Organization 同时只有一个有效邀请；
- 已是成员时返回 Conflict；
- 收件人注册/登录后才能接受；
- 接受者的已验证 Contact 必须匹配邀请邮箱；
- 邀请可撤销、可重新发送，但要限频；
- 不向无权限用户泄漏 Organization 信息。

### 数据模型

```text
OrganizationInvitation
  id UUID
  organizationId FK
  invitedByUserId FK
  normalizedEmail
  role (ADMIN/MEMBER/VIEWER)
  tokenHash UNIQUE
  status (PENDING/ACCEPTED/REVOKED/EXPIRED)
  expiresAt
  acceptedByUserId nullable FK
  acceptedAt nullable
  createdAt / updatedAt
```

还需要设计“同一组织 + 邮箱只有一个 PENDING”的约束。PostgreSQL Partial Unique Index 很适合：

```sql
CREATE UNIQUE INDEX ...
ON organization_invitations (organization_id, normalized_email)
WHERE status = 'PENDING';
```

如果 Prisma Schema 不能完整表达，就在 Migration SQL 中明确维护，并写测试。

### 创建邀请事务

```text
验证 Actor Session/CSRF/Origin
→ require manage_members
→ 标准化 Email
→ 检查已存在 Membership/有效邀请
→ 同一事务：
     创建 Invitation（只存 Token Hash）
     写 AuditEvent(organization.invitation.created)
     写 OutboxEvent(email.send)
→ 201/202
```

邮件发送失败不回滚邀请，因为 Outbox 会重试；但 Invitation 与“需要发邮件”的 Event 必须一起提交。

### 接受邀请事务

```text
从 URL/Cookie 获取一次性 Token
→ Hash 后查询 PENDING + 未过期 Invitation
→ 要求当前登录 User 有相同 verified active Email Contact
→ 同一事务：
     条件 Update Invitation PENDING → ACCEPTED
     创建 Membership
     写 AuditEvent(invitation.accepted)
→ 返回 Organization Membership
```

条件 Update 的 `count === 1` 保证两个 Tab 同时接受时只有一个消费成功；Membership Unique Constraint 是第二道防线。

### 安全与隐私

- 数据库只存邀请 Token Hash；
- Token 有足够随机熵、短期有效、一次性；
- 日志和 Audit 不记录明文 Token；
- 接受时不能只信 URL 中的 Email；必须匹配当前 User 的 verified Contact；
- 邀请创建响应避免不必要暴露“该邮箱是否已有账号”；
- 重发限频，防邮件轰炸；
- 修改目标 Role 需要新的授权/审计；
- Organization 名称出现在邮件里属于信息披露，需要产品确认。

### 幂等与重试

- 创建接口接受 Idempotency Key，网络重试不生成多个邀请/邮件；
- 邮件使用稳定 Logical Event/Message ID；
- 接受重复调用：第一次成功，之后返回稳定的 Already Accepted/Conflict 语义；
- Worker 重试不创建第二条 Invitation，只重复投递同一逻辑邮件。

### 运维和清理

- 指标：邀请创建、接受率、过期率、邮件失败/延迟；
- 告警：Outbox DEAD、投递延迟；
- 定时任务把过期 PENDING 标为 EXPIRED，或查询时按 `expiresAt` 视为过期并异步清理；
- 管理员可查看/撤销邀请；
- 客服重发必须经过权限和审计；
- 定义 PII 保留期，过期后是否继续保存 normalizedEmail。

### 最小测试矩阵

| 场景               | 预期                                 |
| ------------------ | ------------------------------------ |
| OWNER 邀请新邮箱   | Invitation + Audit + Outbox 同时出现 |
| VIEWER 邀请        | 403，三张表都无副作用                |
| 已是成员           | 409，不发邮件                        |
| 重复有效邀请       | 幂等返回或 409，不能两条 PENDING     |
| 错误/过期 Token    | 401/404，不能创建 Membership         |
| 登录用户邮箱不匹配 | 403                                  |
| 两个请求同时接受   | 仅一条 Membership、一个 Accepted     |
| Audit 写失败       | 整个接受事务回滚                     |
| SMTP 暂时失败      | Invitation 保留，Outbox 重试         |
| 跨租户撤销邀请     | 403/404                              |

这个例子展示了后端工作不是“新增三个 Endpoint”，而是定义状态机、不变量、事务、异步边界、隐私、并发和运维生命周期。

---
