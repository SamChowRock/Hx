# ADR 0003: Support Local Credentials Through Verified Contacts

## Context

The product must support people who cannot or do not wish to use a third-party provider. It needs email or phone registration followed by local sign-in, while preserving the BFF session model and avoiding unsafe identity merging.

## Decision

Model one durable user with many authentication methods. Prove control of an email address or E.164 phone number before creating its user and local password credential; registration completion creates them atomically so an attacker cannot preselect a password for someone else's contact. Hash passwords with Argon2id and store verification challenges as single-use, expiring keyed hashes.

Represent third-party login through provider adapters. Store OIDC identity keys from issuer and subject, and store an OAuth profile provider's stable user ID under its configured provider key. Require explicit, authenticated linking rather than matching provider email to an existing account automatically. Every successful authentication method produces the server-side browser session defined by ADR 0002.

## Alternatives considered

- OIDC-only authentication.
- Separate user records for email, phone, and every social provider.
- Automatic account linking by email claim.
- Creating password credentials before contact verification.
- Browser-readable JWTs as the local-login result.

## Consequences

The application owns password reset, verification delivery, account-recovery abuse protection, contact changes, and session revocation. It requires email/SMS provider adapters, queued delivery, rate limiting, monitoring, pending-registration cleanup, and an expanded security test suite. The result keeps the product usable without a provider account and prevents pre-hijacking or an unverified/recycled provider email claim from silently taking over a local account.

## Reconsider when

The product delegates all credential lifecycle to a managed identity service, or a native/mobile client becomes a primary surface and needs a distinct OAuth token architecture.

---

# ADR 0003：通过已验证联系方式支持本地凭据（中文版）

## 背景

产品必须支持无法或不愿使用第三方 Provider 的用户。它需要支持通过邮箱或手机号注册并在之后进行本地登录，同时保留 BFF Session 模型，并避免不安全的身份合并。

## 决策

以一个持久用户对应多种认证方式来建模。在创建用户和本地密码凭据之前，先证明用户控制该邮箱地址或 E.164 手机号；注册完成时以原子方式创建用户和凭据，使攻击者无法预先为他人的联系方式设置密码。使用 Argon2id 哈希密码，并将验证 Challenge 存储为单次使用、会过期的带密钥哈希。

通过 Provider Adapter 表示第三方登录。OIDC 身份使用 Issuer 和 Subject 作为标识；OAuth Profile Provider 则在其已配置的 Provider Key 下保存稳定用户 ID。账号绑定必须经过显式认证，不能通过匹配 Provider Email 自动完成。每一种成功的认证方式最终都创建 ADR 0002 定义的浏览器服务端 Session。

## 已考虑的替代方案

- 仅支持 OIDC 认证。
- 为邮箱、手机号和每个社交 Provider 分别创建用户记录。
- 根据 Email Claim 自动绑定账号。
- 在联系方式验证前创建密码凭据。
- 向浏览器返回可读取的 JWT。

## 后果

应用需要负责密码重置、验证消息发送、账号恢复滥用防护、联系方式变更和 Session 撤销。这需要邮件/SMS Provider Adapter、队列发送、限流、监控、待完成注册清理和更完整的安全测试套件。该方案使用户无需第三方账号也可使用产品，并能阻止预劫持以及未验证或被回收的 Provider Email Claim 静默接管本地账号。

## 重新评估条件

产品将全部凭据生命周期委托给托管身份服务，或者原生/移动客户端成为主要入口并需要独立的 OAuth Token 架构。
