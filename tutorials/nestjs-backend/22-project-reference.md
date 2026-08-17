# 22. 附录：现有 API 与关键文件

> [返回教程首页](README.md)

## 22.1 现有主要 API

### 健康检查

```text
GET /api/health/live
GET /api/health/ready
```

### 注册与登录

```text
POST /api/auth/registrations/email
GET  /api/auth/registrations/email/callback
POST /api/auth/registrations/phone
POST /api/auth/registrations/phone/verify
GET  /api/auth/registration-session
POST /api/auth/registrations/complete
POST /api/auth/login/password
POST /api/auth/external/:provider/start
GET  /api/auth/external/:provider/callback
```

外部认证共用两个 HTTP Endpoint，但由 Provider Key 选择不同 Adapter：

| Provider 类型        | 配置                                          | 实现                 | 临时事务                  |
| -------------------- | --------------------------------------------- | -------------------- | ------------------------- |
| 标准 OIDC            | `OIDC_PROVIDER_KEY`、Issuer、Client ID/Secret | `OidcService`        | `OidcTransaction`         |
| 微信开放平台网站扫码 | `WECHAT_PROVIDER_KEY`、AppID、AppSecret       | `WeChatOAuthService` | `OAuthProfileTransaction` |

共用入口不代表协议相同。OIDC 验证 ID Token/PKCE/Nonce；微信在服务端换取临时 Token、读取 Profile，并验证 AppID 作用域 OpenID 和可选 UnionID 一致性。

### 密码和 Session

```text
POST   /api/auth/password/reset/request
GET    /api/auth/password/reset/callback
GET    /api/auth/password/reset/session
POST   /api/auth/password/reset/confirm
GET    /api/auth/session
GET    /api/auth/sessions
DELETE /api/auth/sessions/:sessionId
POST   /api/auth/password/change
POST   /api/auth/logout
```

### 租户业务

```text
GET  /api/organizations/:organizationId/projects
POST /api/organizations/:organizationId/projects
GET  /api/organizations/:organizationId/members
POST /api/organizations/:organizationId/members
```

### 用户 Profile

```text
GET    /api/profile
PATCH  /api/profile
PATCH  /api/profile/visibility
PUT    /api/profile/avatar
GET    /api/profile/avatar
DELETE /api/profile/avatar
GET    /api/profiles/:userId
GET    /api/profiles/:userId/avatar
```

所有 Profile Route 都需要 Active Session；写入还需要允许的 Origin 与对应 Session 的 CSRF Token。`/profile` 是本人视图，`/profiles/:userId` 是字段 Allowlist 的共享视图；不要假设它们可以互换。

### 站内通知

```text
GET    /api/notifications
GET    /api/notifications/unread-count
GET    /api/notifications/stream
PATCH  /api/notifications/:notificationId/read
PATCH  /api/notifications/read-all
DELETE /api/notifications/:notificationId
DELETE /api/notifications/read
```

通知列表、未读数和 SSE 都只面向当前 Session Actor；写操作还需要 Origin + CSRF。SSE 用于增量提示，列表/未读数才是恢复状态的权威读取。

## 22.2 推荐阅读顺序

1. `README.md`：启动和能力总览；
2. `apps/api/src/projects/projects.controller.ts`：最小 HTTP 边界；
3. `apps/api/src/projects/projects.service.ts`：授权、事务、审计；
4. `apps/api/src/authorization/authorization.service.ts`：Actor 与角色矩阵；
5. `prisma/schema.prisma`：完整数据关系；
6. `apps/api/src/main.ts` 和 `app.module.ts`：应用组装；
7. `libs/platform/src/config/environment.ts`：配置契约；
8. `apps/api/src/http/problem-details.filter.ts`：错误边界；
9. `test/authorization.e2e-spec.ts`：跨租户 E2E；
10. `apps/worker/src/worker.service.ts`：异步可靠性；
11. `apps/api/src/identity/identity.controller.ts`：认证 HTTP 流程；
12. `apps/api/src/identity/identity.service.ts`：认证状态机和安全细节；
13. `apps/api/src/identity/oidc.service.ts`：标准 OIDC Authorization Code + PKCE；
14. `apps/api/src/identity/wechat-oauth.service.ts`：微信网站扫码 OAuth Profile Adapter；
15. `docs/adr/0004-wechat-website-oauth.md`：OpenID、UnionID、Token 和账号合并边界；
16. `apps/api/src/profile/profile.controller.ts`：本人资料的 HTTP/CSRF/Multipart 边界；
17. `apps/api/src/profile/profile.service.ts`：可见性、昵称行锁配额、审计和对象引用切换；
18. `apps/api/src/profile/avatar-storage.service.ts`：Sharp 处理与私有 S3/MinIO Adapter；
19. `test/profile.e2e-spec.ts`：隐私、并发、上传和拒绝路径；
20. `apps/api/src/notifications/notifications.service.ts`：游标、用户范围收件箱和幂等创建；
21. `apps/api/src/notifications/notification-realtime.service.ts`：SSE 回放、心跳和数据库对账；
22. `libs/platform/src/notifications/notification-contract.ts`：内部输入/Outbox Payload 契约；
23. `test/notifications.e2e-spec.ts`：通知 API、隐私与实时链路；
24. `docs/adr/`、`docs/THREAT_MODEL.md`：其他决策背后的原因。

## 22.3 最后记住的五条原则

1. **Controller 管协议，Service 管业务。**
2. **认证得到 Actor，授权必须结合租户和动作。**
3. **数据库约束与事务守住一致性。**
4. **外部副作用走 Outbox + 幂等 Worker。**
5. **每个高风险功能都要有拒绝路径测试、审计和可运维性。**

当你不确定一个功能该怎么实现时，就从这五条往回推。它们比记住多少 NestJS Decorator 更能决定后端是否可靠。
