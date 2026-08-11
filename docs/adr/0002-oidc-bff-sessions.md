# ADR 0002: Use OIDC Through a Backend-for-Frontend Session

## Context

The reference product is browser-first and multi-tenant. Storing long-lived provider tokens in browser JavaScript increases exposure to XSS and complicates revocation.

## Decision

Use an OIDC Authorization Code flow through the NestJS BFF. The BFF validates identity-provider responses and issues a server-side session represented in the browser by an opaque `HttpOnly`, `Secure`, appropriately scoped `SameSite` cookie. Store a hash of the session secret in PostgreSQL initially. Cookie-authenticated state changes use CSRF protection.

ADR 0003 extends this session boundary to verified local credentials and external OAuth profile providers. It does not change the rule that browser authentication ends in a server-side session rather than a browser-readable provider or application bearer token.

## Alternatives considered

- SPA bearer tokens stored in browser JavaScript.
- Self-managed passwords from the first release.
- Stateless JWT session cookies.

## Consequences

The API owns session revocation, rotation, and device visibility. It must protect the OIDC callback and CSRF boundary. Mobile and machine clients use distinct OAuth flows/audiences.

## Reconsider when

A non-browser client becomes the primary product surface, or measured session scale requires a dedicated session store with an explicit durability/failover design.

---

# ADR 0002：通过 Backend-for-Frontend Session 使用 OIDC（中文版）

## 背景

参考产品以浏览器为主要入口并支持多租户。在浏览器 JavaScript 中存储长期有效的 Provider Token 会扩大 XSS 暴露面，并使撤销更加复杂。

## 决策

通过 NestJS BFF 使用 OIDC Authorization Code Flow。BFF 校验身份提供商响应，并签发服务端 Session；浏览器仅持有一个不透明、设置了 `HttpOnly`、`Secure` 和适当 `SameSite` 属性的 Cookie。Session Secret 先以哈希形式存储在 PostgreSQL 中。使用 Cookie 认证的状态变更操作必须使用 CSRF 防护。

ADR 0003 将此 Session 边界扩展至经过验证的本地凭据和外部 OAuth Profile Provider。它不改变以下规则：浏览器认证最终得到的是服务端 Session，而不是浏览器可读的 Provider 或应用 Bearer Token。

## 已考虑的替代方案

- 在浏览器 JavaScript 中存储 SPA Bearer Token。
- 从第一个版本开始自行管理密码。
- 使用无状态 JWT Session Cookie。

## 后果

API 负责 Session 撤销、轮换和设备可见性。它必须保护 OIDC Callback 和 CSRF 边界。移动端和机器客户端使用不同的 OAuth Flow 与 Audience。

## 重新评估条件

非浏览器客户端成为主要产品入口，或者实测 Session 规模要求使用专用 Session Store，并已有明确的持久性/故障切换设计。
