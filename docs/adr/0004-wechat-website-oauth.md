# ADR 0004: WeChat Website OAuth Through the BFF

## Context

WeChat sign-in is important for users in mainland China. WeChat Open Platform website applications expose an authorization-code-style OAuth flow, but they are not an OpenID Connect provider: there is no ID token, discovery document, or standard OIDC claim validation. Treating WeChat as the existing generic OIDC provider would weaken validation and hide provider-specific identity rules.

WeChat has two identifiers with different scopes. An OpenID is stable within one application. A UnionID is meaningful across applications only when those applications belong to the same WeChat Open Platform account, and it may be absent before an application is bound to that account. A login identifier must not change merely because UnionID becomes available later.

## Decision

Implement the initial WeChat integration as a dedicated OAuth profile adapter for an approved WeChat Open Platform **website application**. It reuses the BFF endpoints:

- `POST /api/auth/external/:provider/start`
- `GET /api/auth/external/:provider/callback`

The start endpoint creates a ten-minute, database-backed transaction with a high-entropy state and a separate browser-binding secret. Only keyed hashes are stored. The browser binding is held in a short-lived `HttpOnly`, `Secure` in deployed environments, `SameSite=Lax` cookie because the provider returns through a cross-site top-level navigation. The callback consumes the transaction exactly once, exchanges the code and retrieves the profile server-side over fixed HTTPS endpoints, rejects redirects and malformed or oversized responses, and discards the WeChat access and refresh tokens after resolving the identity.

Use the website application's AppID-scoped issuer plus `openid:<OpenID>` as the durable external-identity key. If both token and profile responses contain UnionID, require them to match, but do not use an opportunistically present UnionID as the login key. Do not infer a verified email or phone number from WeChat, and never automatically merge a WeChat identity with an existing local or external account. A successful login creates the same opaque application session as every other authentication method and records an audit event.

Configuration is all-or-nothing through `WECHAT_PROVIDER_KEY`, `WECHAT_APP_ID`, and `WECHAT_APP_SECRET`. The provider key must not collide with the generic OIDC provider key. Production credentials belong in a secret manager, not in source control.

## Scope boundary

This adapter covers desktop browser QR-code login for a website application. Official Account web authorization, Mini Program login, native mobile SDK login, and QR-code account binding have different entry points, scopes, callback behavior, or credentials and require separate adapters and tests.

Cross-application account unification is also out of scope. Before supporting multiple WeChat applications, add a model that records the explicit WeChat Open Platform account boundary and stores both app-scoped OpenID and correctly scoped UnionID aliases. Define conflict recovery for aliases that already point to different product users. Do not switch an existing identity key from OpenID to UnionID in place.

## Alternatives considered

- Configure WeChat as if it were a standards-compliant OIDC provider.
- Exchange the authorization code in browser JavaScript and send the profile to the API.
- Use UnionID when present and fall back to OpenID when absent.
- Depend on a managed identity broker for the first integration.

## Consequences

The product needs an approved WeChat Open Platform website application, an approved callback domain, HTTPS in deployed environments, credentials per environment, provider availability/error monitoring, and a test account and runbook for release verification. The dedicated adapter is additional code, but keeps WeChat tokens and AppSecret behind the server boundary and makes identifier scope explicit. Availability of WeChat login must not be treated as proof that the user's WeChat account supplies a verified product contact or a phishing-resistant factor.

## Reconsider when

Revisit this decision when the product adds an Official Account, Mini Program, native application, multiple website AppIDs, explicit account linking, or continuing access to WeChat APIs. Continuing API authorization must use a separate encrypted connection model with scope, expiry, refresh, revocation, and audit policies rather than adding tokens to the login identity.

---

# ADR 0004：通过 BFF 接入微信网站 OAuth（中文版）

## 背景

微信登录对于中国大陆用户十分重要。微信开放平台的网站应用提供一种类似 OAuth Authorization Code 的流程，但它不是 OpenID Connect Provider：没有 ID Token、Discovery Document，也没有标准 OIDC Claim 校验。若把微信伪装成现有通用 OIDC Provider，会削弱校验并掩盖微信特有的身份标识规则。

微信提供作用域不同的两种标识。OpenID 在单个应用内稳定；UnionID 只有在多个应用属于同一微信开放平台账号时才具有跨应用含义，而且应用绑定开放平台之前可能拿不到 UnionID。登录标识不能因为未来开始返回 UnionID 就发生变化。

## 决策

首个微信集成采用专用 OAuth Profile Adapter，面向已经审核通过的微信开放平台**网站应用**。它复用 BFF Endpoint：

- `POST /api/auth/external/:provider/start`
- `GET /api/auth/external/:provider/callback`

Start Endpoint 创建十分钟有效、存储在数据库中的 Transaction，其中包含高熵 State 和独立 Browser-binding Secret；数据库只保存带密钥哈希。Browser Binding 存放在短期 `HttpOnly` Cookie 中，部署环境还使用 `Secure`。由于 Provider 会通过跨站顶层导航返回，Cookie 使用 `SameSite=Lax`。Callback 只消费 Transaction 一次，通过固定 HTTPS Endpoint 在服务端交换 Code 并获取 Profile；系统拒绝重定向、畸形响应和超大响应，在解析身份后立即丢弃微信 Access Token 与 Refresh Token。

使用网站应用 AppID 作用域的 Issuer 加 `openid:<OpenID>` 作为持久 External Identity Key。如果 Token 与 Profile Response 都包含 UnionID，则要求二者一致，但不能把偶尔存在的 UnionID 用作登录主键。系统不从微信推断已验证邮箱或手机号，也绝不自动把微信身份与已有本地账号或外部账号合并。登录成功后创建与其他认证方式相同的不透明应用 Session，并写入 Audit Event。

通过 `WECHAT_PROVIDER_KEY`、`WECHAT_APP_ID` 和 `WECHAT_APP_SECRET` 进行全有或全无的配置。Provider Key 不能与通用 OIDC Provider Key 冲突。生产凭据必须放入 Secret Manager，不能提交到源码仓库。

## 范围边界

本 Adapter 只覆盖网站应用的桌面浏览器扫码登录。公众号网页授权、小程序登录、原生移动 SDK 登录和扫码绑定账号具有不同的入口、Scope、Callback 行为或凭据，必须分别实现 Adapter 和测试。

跨应用账号统一也不在本次范围内。在支持多个微信应用前，应增加显式记录微信开放平台账号边界的模型，同时保存 App 作用域 OpenID 和正确作用域 UnionID Alias，并定义两个 Alias 已指向不同产品用户时的冲突恢复流程。不能直接把已有 Identity Key 从 OpenID 原地切换成 UnionID。

## 已考虑的替代方案

- 把微信配置成符合标准的 OIDC Provider。
- 在浏览器 JavaScript 中交换 Authorization Code，再把 Profile 发送给 API。
- 有 UnionID 时使用 UnionID，否则回退到 OpenID。
- 首次集成直接依赖托管身份代理服务。

## 后果

产品需要审核通过的微信开放平台网站应用、审核通过的回调域名、部署环境 HTTPS、按环境管理的凭据、Provider 可用性/错误监控，以及用于发布验证的测试账号和 Runbook。专用 Adapter 会增加代码量，但能把微信 Token 与 AppSecret 保留在服务端边界，并明确身份标识的作用域。微信登录可用并不代表微信账号提供了经过产品验证的联系方式，也不能把微信登录视为抗钓鱼认证因素。

## 重新评估条件

当产品加入公众号、小程序、原生应用、多个网站 AppID、显式账号绑定或需要持续访问微信 API 时，应重新评估本决策。持续 API 授权必须使用独立的加密 Connection 模型，定义 Scope、过期、刷新、撤销和审计策略，不能把 Token 添加到登录 Identity 中。
