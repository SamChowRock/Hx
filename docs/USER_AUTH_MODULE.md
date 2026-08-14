# User and Authentication Module Design

## Purpose and scope

This module gives a browser-first product one logical account with several independent authentication methods:

- Third-party sign-in through configured OIDC or OAuth 2.0 identity providers.
- Registration with a verified email address or verified phone number, followed by password creation.
- Password sign-in with a verified email address or E.164 phone number.
- Contact verification, password recovery, session management, and explicit account linking.

The module does not attempt to prove that one physical person owns only one account; that would require a separate identity-proofing or KYC product decision. It keeps one durable `User` record per logical product account and attaches multiple sign-in methods to that record.

Browser authentication extends ADR 0002. Successful local or external authentication creates an opaque server-side session and sets a hardened cookie. Browser JavaScript never receives the session secret, provider access token, provider refresh token, or ID token. Native and machine clients are a separate future surface with their own OAuth clients, audiences, and token policies.

## Product decisions

| Concern            | Decision                                                                                                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account unit       | `User` is the durable product account. Verified contacts, a password credential, and external identities are authentication methods attached to it.                                |
| Registration order | Prove control of an email address or phone number first. Create the user and password credential only when a short-lived verified registration is completed.                       |
| Local login        | A verified email address or verified E.164 phone number plus password. An unverified contact is never a login identifier.                                                          |
| External login     | Use a provider adapter. Standards-compliant OIDC providers use issuer + subject; OAuth profile providers use provider key + stable provider user ID.                               |
| Linking            | Never merge accounts because two providers report the same email. Link only after authenticating the existing account or from an authenticated session with recent authentication. |
| Verification       | Email uses a single-use high-entropy link token. Phone uses a single-use numeric OTP plus an opaque challenge ID. Both expire quickly and are stored only as keyed hashes.         |
| Passwords          | Store an Argon2id hash, never encryption or plaintext. Start with memory 19 MiB, time cost 2, and parallelism 1; benchmark and raise the cost where production capacity permits.   |
| Sessions           | Store only a keyed hash of a randomly generated cookie secret. Rotate after authentication and security-sensitive changes. Revoke all sessions after password recovery.            |
| MFA and passkeys   | Require MFA for privileged administration. When stronger consumer authentication is needed, prefer passkeys before implementing a proprietary TOTP experience.                     |

## Module boundaries

```text
apps/api/src/identity/
  identity.module.ts
  presentation/http/          # controllers, DTOs, cookies, CSRF boundary
  application/                # use cases and provider/repository ports
  domain/                     # entities, state machines, policies, stable errors
  infrastructure/             # Prisma, Argon2id, OIDC/OAuth, email/SMS adapters
  jobs/                       # outbox handlers and message templates
```

HTTP controllers validate input, invoke one application use case, and set or clear cookies. The application layer owns registration, linking, recovery, and session-rotation invariants. Infrastructure adapters implement ports such as `PasswordHasher`, `ExternalIdentityProvider`, `VerificationSender`, `SessionRepository`, and `UserRepository`.

The Worker sends email and SMS from transactional outbox events. API requests never wait for delivery providers. Authentication events that affect authorization or user state are committed in the same database transaction as their outbox or audit record.

External authentication uses two adapter families:

```text
ExternalIdentityProvider
  OidcIdentityProvider          # validates issuer, subject, ID token, nonce, JWKS
  OAuthProfileIdentityProvider  # exchanges code, then fetches stable provider profile
```

OAuth access tokens used only to retrieve an identity profile are discarded after the callback. If the product later needs continuing access to a provider API, store that authorization in a separate encrypted `external_connections` model with scopes, expiry, refresh, revocation, and audit policies; it is not part of the login identity.

## Data model

Use UUID or ULID primary keys, foreign keys, and `timestamptz` UTC timestamps. Normalize email using one documented product policy and normalize phone input to E.164 using a proven library with an explicit default-country policy. Never apply provider-specific alias rules such as removing dots or `+tags`. Contact values are sensitive data and are never returned by unrelated APIs or written to ordinary logs.

```text
users
  id, display_name, status(active|disabled|pending_deletion),
  created_at, updated_at

user_contacts
  id, user_id, type(email|phone), normalized_value, verified_at NOT NULL,
  is_primary, retired_at NULL, created_at, updated_at
  UNIQUE(type, normalized_value) WHERE retired_at IS NULL
  UNIQUE(user_id, type) WHERE is_primary = true AND retired_at IS NULL

password_credentials
  user_id PK, password_hash, password_changed_at,
  failed_attempt_count, last_failed_at NULL, locked_until NULL,
  created_at, updated_at

external_identities
  id, user_id, protocol(oidc|oauth2_profile), provider_key,
  provider_subject, issuer NULL, provider_email NULL,
  profile_json NULL, linked_at, last_login_at
  UNIQUE(provider_key, provider_subject)
  CHECK(protocol != 'oidc' OR issuer IS NOT NULL)

registration_intents
  id, contact_type(email|phone), normalized_value,
  status(pending|verified|consumed|expired), verified_at NULL,
  completion_secret_hash NULL, hash_key_id NULL,
  expires_at, consumed_at NULL, created_at

verification_challenges
  id, purpose(register_email|register_phone|verify_contact|reset_password),
  registration_intent_id NULL, contact_id NULL,
  secret_hash, hash_key_id, expires_at, consumed_at NULL,
  invalidated_at NULL, attempt_count, max_attempts,
  requested_ip_hash, created_at
  CHECK(exactly one supported subject/purpose combination is present)

sessions
  id, user_id, secret_hash, hash_key_id, csrf_secret_hash,
  created_at, absolute_expires_at, idle_expires_at, last_seen_at,
  revoked_at NULL, revoke_reason NULL,
  user_agent_summary NULL, ip_prefix_hash NULL
  UNIQUE(secret_hash)
  INDEX(user_id, revoked_at, absolute_expires_at)

authentication_events
  id, user_id NULL, type, outcome, provider_key NULL,
  contact_hash NULL, ip_prefix_hash, user_agent_summary NULL,
  request_id, occurred_at
```

Registration intents expire and are physically deleted after a short operational retention period. Starting registration for an existing verified contact returns the same public response but does not create a new credential or alter that account. Starting it again for an unconsumed intent may replace its previous challenge only after resend and velocity limits pass; it never changes a password.

The final migration must encode the stated foreign keys, enum or check constraints, partial indexes, and atomic consume conditions. A challenge is consumed with a conditional update requiring `consumed_at IS NULL`, `invalidated_at IS NULL`, a valid expiry, and remaining attempts. Keyed hashes include `hash_key_id` so secrets remain verifiable during controlled key rotation. Define a deliberate cooldown and support process before a retired email address or recycled phone number can identify a different user.

## HTTP contract

All routes are under `/api/auth`. Responses use the project Problem Details convention and stable machine-readable error codes. Registration, login, verification-request, and reset-request responses remain generic where account existence would otherwise be revealed.

### Registration and local authentication

| Method and route                    | Request                                               | Result                                                                                                                                                                      |
| ----------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /registrations/email`         | `email`                                               | Creates or safely resumes an eligible registration intent and queues an email. Always returns `202`. No password is accepted.                                               |
| `GET /registrations/email/callback` | `token`                                               | Atomically verifies the email intent, sets a short-lived `__Host-registration` cookie, and redirects to a fixed completion page with the token removed from the URL.        |
| `POST /registrations/phone`         | `phone`                                               | Creates or safely resumes an eligible intent and queues an SMS OTP. Always returns `202` with an opaque `challengeId` when eligible and a shape-compatible decoy otherwise. |
| `POST /registrations/phone/verify`  | `challengeId`, `code`                                 | Verifies the phone intent and sets the short-lived registration cookie.                                                                                                     |
| `GET /registration-session`         | registration cookie                                   | Returns safe verified-registration metadata and a registration CSRF token.                                                                                                  |
| `POST /registrations/complete`      | registration cookie + CSRF, `password`, `displayName` | Atomically creates the user, verified contact, credential, and session and consumes the intent.                                                                             |
| `POST /login/password`              | `identifier`, `password`                              | Accepts a verified email or phone and returns one generic credential error on failure. On success, creates a new rotated session.                                           |
| `POST /password/reset/request`      | `identifier`                                          | Always returns `202`; queues recovery only for an eligible verified contact.                                                                                                |
| `POST /password/reset/confirm`      | `token` or `challengeId` + `code`, `newPassword`      | Atomically changes the hash, consumes/invalidate resets, revokes all sessions, clears lock state, and writes an audit event. Ordinary login is required afterward.          |
| `POST /password/change`             | current password, new password, session + CSRF        | Requires recent authentication, changes the hash, rotates the current session, and optionally revokes the caller's other sessions.                                          |

The email callback suppresses query strings in access logs, sets `Referrer-Policy: no-referrer`, consumes the token once, and immediately redirects to a clean URL. The registration cookie is opaque, `HttpOnly`, short-lived, bound to the verified intent, and unusable after completion.

### External authentication and account linking

| Method and route                          | Request                                  | Result                                                                                                                                                             |
| ----------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /external/:provider/start`          | intent (`sign_in`), validated `returnTo` | Creates a one-time state/PKCE transaction and returns the provider authorization URL. The frontend navigates to it.                                                |
| `GET /external/:provider/callback`        | provider `code`, `state`                 | Validates and consumes the transaction, resolves the provider identity, creates or links as allowed, creates a session, and redirects to an allowlisted clean URL. |
| `POST /external/:provider/link/start`     | session + CSRF + recent authentication   | Creates a transaction bound to the current user and returns an authorization URL.                                                                                  |
| `DELETE /external-identities/:identityId` | session + CSRF + recent authentication   | Unlinks an identity only when another viable authentication method remains.                                                                                        |

The first concrete OAuth profile adapter is WeChat Open Platform website QR login. Configure all of `WECHAT_PROVIDER_KEY`, `WECHAT_APP_ID`, and `WECHAT_APP_SECRET`; partial configuration fails during application startup. The adapter uses `snsapi_login`, performs the code exchange and profile request only from the API, and discards provider tokens. It keys an identity by the website AppID scope plus OpenID. UnionID is checked for consistency when present, but cross-application unification requires the additional model and conflict policy in ADR 0004. Official Account, Mini Program, and native-app login are separate future adapters.

### Sessions and contacts

| Method and route              | Request                                           | Result                                                                          |
| ----------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------- |
| `GET /session`                | session cookie                                    | Returns the current user, safe session metadata, and a synchronizer CSRF token. |
| `POST /logout`                | session + CSRF                                    | Revokes the current session and clears its cookie.                              |
| `GET /sessions`               | session cookie                                    | Lists the caller's active sessions.                                             |
| `DELETE /sessions/:id`        | session + CSRF                                    | Revokes a session owned by the caller.                                          |
| `POST /contacts/email`        | new email, session + CSRF + recent authentication | Starts verification without changing the current primary contact.               |
| `POST /contacts/phone`        | new phone, session + CSRF + recent authentication | Starts verification without changing the current primary contact.               |
| `POST /contacts/:id/verify`   | token or challenge ID + code                      | Verifies a pending contact addition.                                            |
| `PATCH /contacts/:id/primary` | session + CSRF + recent authentication            | Promotes a verified contact of the requested type.                              |
| `DELETE /contacts/:id`        | session + CSRF + recent authentication            | Retires a contact only when account recovery and login remain viable.           |

Registration start and reset request may accept an `Idempotency-Key`, but idempotency is not an abuse control. Rate limits and send quotas apply independently. A `returnTo` value must be a relative path or an exact configured allowlist entry; it can never choose an arbitrary origin.

## Authentication flows

### Email or phone registration

1. Validate and normalize the contact, then apply IP, contact-hash, device, resend, and provider-spend limits before delivery.
2. Create or safely resume a `registration_intent`, a single-use challenge, and an outbox event in one transaction. Do not create a user or password credential yet.
3. The Worker delivers the email link or SMS OTP. Existing accounts receive the same public API response without being modified.
4. Challenge confirmation atomically proves the intent and issues a short-lived completion secret through the registration cookie. It does not create an authenticated user session.
5. Completion requires the verified registration cookie, allowed `Origin`, CSRF proof, display name, and a valid new password. It creates the user, verified contact, password credential, audit event, outbox events, and browser session in one transaction, then permanently consumes the intent.
6. Expired, replayed, invalidated, over-attempt, or already-consumed challenges require a new eligible registration attempt.

This ordering prevents account pre-hijacking: a person clicking an unsolicited email cannot activate a password selected earlier by an attacker.

### External sign-in

1. Resolve only a configured provider. Create a short-lived transaction containing random `state`, PKCE verifier, provider key, intent, expiry, and allowlisted return target. OIDC transactions also include `nonce`. Bind the transaction to a signed/encrypted transient `__Host-` cookie.
2. The callback consumes state exactly once and exchanges the code server-side. OIDC adapters validate issuer, audience, signature/JWKS, expiry, nonce, subject, and authorized-party claims where applicable. OAuth profile adapters validate the token response and fetch the stable provider user ID from the provider's authenticated profile endpoint.
3. If `(provider_key, provider_subject)` is already linked, reject disabled users or create a rotated session for the linked user.
4. If the identity is new and a trusted provider email corresponds to an existing verified contact, create a short-lived link intent and require authentication to that existing account. Do not create a second user and do not attach the provider yet.
5. If there is no collision, create a new user and external identity atomically. Provider profile fields are optional display defaults, not authorization data. A provider email becomes a login contact only through the product's own explicit verification or provider-trust policy.
6. Clear the transaction, record an authentication event, discard login-only provider tokens, rotate the BFF session, and redirect only to the stored return target.

For WeChat website login, the transaction is stored in `oauth_profile_transactions`; the browser holds only its independent binding secret. The external callback cookie uses `SameSite=Lax` because WeChat returns by cross-site top-level navigation, while the resulting application session remains `SameSite=Strict`. Fixed provider hosts, redirect rejection, a ten-second timeout, bounded response bodies, OpenID equality, optional UnionID consistency, and a database compare-and-set consumption protect the provider boundary. Provider nickname is display-only; WeChat does not establish a verified application email or phone contact.

## Password policy

- Default to at least 15 Unicode characters when password login is not protected by MFA; allow at least 64 characters and set a documented higher input-size ceiling to prevent resource exhaustion.
- Allow Unicode, whitespace, and paste/password managers. Do not impose composition rules, silently truncate, or require periodic password changes.
- Reject common and known-compromised passwords without sending the plaintext password to application logs or analytics.
- Store the Argon2 encoded hash with its parameters and rehash after a successful login when the current policy is stronger.
- Bound concurrent Argon2 work so password attacks cannot exhaust API memory. Use generic failures and per-account plus per-source throttling; do not rely on permanent account lockout as the primary control.

## Session and CSRF contract

- The production session cookie is named `__Host-session` and uses `Secure; HttpOnly; Path=/` with no `Domain`. Prefer `SameSite=Strict`; use `Lax` only when a documented cross-site top-level navigation requires it. OIDC/OAuth transactions use a distinct short-lived cookie.
- A session has both an absolute lifetime and an idle lifetime. Update `last_seen_at` in bounded intervals rather than writing on every request. Expired, revoked, disabled-user, and credential-invalidated sessions fail closed.
- `GET /api/auth/session` returns a browser-readable synchronizer CSRF token associated with the server-side session. Every cookie-authenticated mutation supplies it in `X-CSRF-Token`; the API also validates `Origin` and, where appropriate, `Sec-Fetch-Site`/`Referer`.
- Rotate the session secret at authentication, privilege changes, password changes, identity/contact changes, recovery, and suspicious activity. Rotation invalidates the prior secret atomically.
- Password recovery revokes every active session, including any session in the browser performing recovery. Administrative disable and revoke-all operations take effect on the next request.

## Security and abuse controls

- Run authentication endpoints behind TLS, enforce a strict CORS origin allowlist, apply secure headers, and never cache authentication responses containing secrets.
- Rate-limit independently by IP prefix, contact hash, user ID, challenge, session/device, and delivery provider budget where appropriate. Escalate to CAPTCHA or risk scoring only when observed abuse justifies it.
- Keep account-sensitive response bodies and meaningful timing reasonably uniform to reduce enumeration. A user who has already proved control of a contact may receive more specific recovery guidance.
- Generate tokens and OTPs cryptographically. Tokens are high entropy; OTPs are short-lived, attempt-limited, and validated only with their opaque challenge ID. Neither appears in logs, analytics, traces, referrers, or error reports.
- Require recent authentication for changing credentials, primary contacts, external identities, MFA, or deletion. Notify existing verified contacts of security-sensitive changes without including secrets.
- Never remove the last viable sign-in and recovery method. Treat SMS as a possession signal with SIM-swap and number-recycling risk, not as phishing-resistant MFA.
- Persist audit events for authentication, verification, recovery, session revocation, contact changes, identity links, and administrative actions. Mask or hash contact data and never log passwords, authorization codes, tokens, cookies, or complete recovery URLs.
- Store provider client secrets and HMAC keys in the production secret manager. Rotate keyed-hash secrets with explicit active/verification key IDs and an overlapping-key procedure.

## Authorization integration

Authentication resolves a `CurrentActor` containing `userId`, `sessionId`, authentication time, authentication methods, and selected organization context. Authentication does not grant tenant access. Organization membership and domain policies remain authoritative for every use case, Worker job, and administrative command.

Check `status=disabled` on every session-backed request, not only at login. The administrative control plane may disable a user or revoke all sessions only with stronger authorization, recent MFA, a reason, and an audit record.

## Delivery plan and acceptance tests

1. Add PostgreSQL/Prisma, forward-only migrations, the tables and constraints above, an Argon2id adapter, session/CSRF support, provider ports, delivery ports, and outbox jobs.
2. Deliver verified email registration, password sign-in, logout, session revocation, password change, and recovery.
3. Add phone registration/recovery with a real SMS provider, country policy, spend limits, number-recycling policy, and delivery monitoring.
4. Add one standards-compliant OIDC provider through `OidcIdentityProvider`; use the dedicated OAuth profile adapter for WeChat website QR login and add other non-OIDC providers only through reviewed adapters.
5. Add contact management, explicit external-identity linking, passkeys, and privileged-operation step-up authentication in risk-driven increments.

Required automated coverage includes normalization and uniqueness races; registration pre-hijacking attempts; pending-intent expiry and cleanup; password verification and rehash; expired, replayed, or over-attempt challenges; enumeration-resistant responses; resend and rate limits; session rotation, idle/absolute expiry, and revocation; CSRF and login-CSRF attempts; OIDC state/nonce/PKCE/issuer/audience failures; OAuth profile substitution; external email collision without implicit linking; last-sign-in-method protection; disabled-user rejection; tenant isolation after sign-in; password-recovery races; outbox retries; and audit/log redaction.

## Open choices before implementation

- For every enabled provider, obtain production credentials, exact callback URLs/domains, minimal scopes, test accounts, availability monitoring, credential-rotation procedures, and a release-verification runbook.
- Select email and SMS delivery providers, supported countries, sender identities, templates, cost guardrails, and fallback behavior.
- Decide whether phone registration is required at launch, since SMS introduces cost, deliverability, SIM-swap risk, number recycling, and regional compliance obligations.
- Define concrete session, registration, verification, OTP, recovery, resend, and recent-authentication lifetimes in deployable configuration.
- Define contact retirement/reuse, account retention, identity deletion, legal hold, and data-export policies.
- Decide when passkeys or other MFA become mandatory for administrators and high-risk actions.

---

# 用户与认证模块设计（中文版）

## 目的与范围

本模块为以浏览器为主要入口的产品提供一个逻辑账号，并支持多种彼此独立的认证方式：

- 通过已配置的 OIDC 或 OAuth 2.0 身份提供商进行第三方登录。
- 使用已验证的邮箱地址或手机号完成注册，然后创建密码。
- 使用已验证的邮箱地址或 E.164 手机号加密码登录。
- 联系方式验证、密码恢复、Session 管理和显式账号绑定。

本模块不试图证明一个现实中的人只能拥有一个账号；这需要单独的身份核验或 KYC 产品决策。系统为每个逻辑产品账号保留一个持久的 `User` 记录，并将多种登录方式附加到该记录。

浏览器认证沿用 ADR 0002。任何本地或外部认证成功后，都会创建一个不透明的服务端 Session，并设置经过加固的 Cookie。浏览器 JavaScript 永远不会获得 Session Secret、Provider Access Token、Provider Refresh Token 或 ID Token。原生客户端和机器客户端属于未来单独的使用入口，应拥有各自的 OAuth Client、Audience 和 Token Policy。

## 产品决策

| 关注点         | 决策                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 账号单位       | `User` 是持久的产品账号。已验证联系方式、密码凭据和外部身份都是附加在其上的认证方式。                                                       |
| 注册顺序       | 先证明用户控制邮箱或手机号。只有完成短期有效的已验证注册后，才创建用户和密码凭据。                                                          |
| 本地登录       | 使用已验证的邮箱地址或 E.164 手机号加密码。未验证的联系方式永远不能作为登录标识。                                                           |
| 外部登录       | 使用 Provider Adapter。符合标准的 OIDC Provider 使用 Issuer + Subject；OAuth Profile Provider 使用 Provider Key + 稳定的 Provider User ID。 |
| 账号绑定       | 绝不因为两个 Provider 返回相同邮箱就合并账号。只有先认证现有账号，或从已登录且近期重新认证的 Session 发起，才允许绑定。                     |
| 验证           | 邮箱使用单次有效的高熵链接 Token；手机使用单次有效的数字 OTP 加不透明 Challenge ID。二者都快速过期，并仅以带密钥哈希保存。                  |
| 密码           | 使用 Argon2id 哈希，绝不加密或明文保存。初始参数为内存 19 MiB、时间成本 2、并行度 1；经过基准测试后，在生产容量允许时提高成本。             |
| Session        | 仅保存随机 Cookie Secret 的带密钥哈希。认证和安全敏感变更后进行轮换；密码恢复后撤销全部 Session。                                           |
| MFA 与 Passkey | 特权管理必须使用 MFA。消费者认证需要更强安全性时，优先采用 Passkey，再考虑自行实现 TOTP。                                                   |

## 模块边界

```text
apps/api/src/identity/
  identity.module.ts
  presentation/http/          # Controller、DTO、Cookie、CSRF 边界
  application/                # Use Case 与 Provider/Repository Port
  domain/                     # Entity、状态机、Policy、稳定错误
  infrastructure/             # Prisma、Argon2id、OIDC/OAuth、邮件/SMS Adapter
  jobs/                       # Outbox Handler 与消息模板
```

HTTP Controller 负责校验输入、调用一个应用层 Use Case，以及设置或清除 Cookie。应用层负责注册、绑定、恢复和 Session 轮换的不变量。基础设施 Adapter 实现 `PasswordHasher`、`ExternalIdentityProvider`、`VerificationSender`、`SessionRepository` 和 `UserRepository` 等 Port。

Worker 通过 Transactional Outbox Event 发送邮件和 SMS。API 请求永远不等待消息发送 Provider。会影响授权或用户状态的认证事件，必须与对应的 Outbox 或审计记录在同一个数据库事务中提交。

外部认证使用两类 Adapter：

```text
ExternalIdentityProvider
  OidcIdentityProvider          # 校验 Issuer、Subject、ID Token、Nonce、JWKS
  OAuthProfileIdentityProvider  # 交换 Code，然后获取稳定的 Provider Profile
```

仅用于获取身份 Profile 的 OAuth Access Token 应在 Callback 完成后丢弃。如果产品未来需要持续访问 Provider API，应将这类授权存储在独立、加密的 `external_connections` 模型中，并定义 Scope、过期、刷新、撤销和审计策略；它不属于登录身份本身。

## 数据模型

使用 UUID 或 ULID 主键、外键和 UTC `timestamptz` 时间戳。使用一项明确记录的产品策略规范化邮箱，并通过成熟库和明确的默认国家/地区策略将手机号规范化为 E.164。绝不应用移除点号或 `+tag` 等 Provider 特有别名规则。联系方式属于敏感数据，不能由无关 API 返回，也不能写入普通日志。

```text
users
  id, display_name, status(active|disabled|pending_deletion),
  created_at, updated_at

user_contacts
  id, user_id, type(email|phone), normalized_value, verified_at NOT NULL,
  is_primary, retired_at NULL, created_at, updated_at
  UNIQUE(type, normalized_value) WHERE retired_at IS NULL
  UNIQUE(user_id, type) WHERE is_primary = true AND retired_at IS NULL

password_credentials
  user_id PK, password_hash, password_changed_at,
  failed_attempt_count, last_failed_at NULL, locked_until NULL,
  created_at, updated_at

external_identities
  id, user_id, protocol(oidc|oauth2_profile), provider_key,
  provider_subject, issuer NULL, provider_email NULL,
  profile_json NULL, linked_at, last_login_at
  UNIQUE(provider_key, provider_subject)
  CHECK(protocol != 'oidc' OR issuer IS NOT NULL)

registration_intents
  id, contact_type(email|phone), normalized_value,
  status(pending|verified|consumed|expired), verified_at NULL,
  completion_secret_hash NULL, hash_key_id NULL,
  expires_at, consumed_at NULL, created_at

verification_challenges
  id, purpose(register_email|register_phone|verify_contact|reset_password),
  registration_intent_id NULL, contact_id NULL,
  secret_hash, hash_key_id, expires_at, consumed_at NULL,
  invalidated_at NULL, attempt_count, max_attempts,
  requested_ip_hash, created_at
  CHECK(exactly one supported subject/purpose combination is present)

sessions
  id, user_id, secret_hash, hash_key_id, csrf_secret_hash,
  created_at, absolute_expires_at, idle_expires_at, last_seen_at,
  revoked_at NULL, revoke_reason NULL,
  user_agent_summary NULL, ip_prefix_hash NULL
  UNIQUE(secret_hash)
  INDEX(user_id, revoked_at, absolute_expires_at)

authentication_events
  id, user_id NULL, type, outcome, provider_key NULL,
  contact_hash NULL, ip_prefix_hash, user_agent_summary NULL,
  request_id, occurred_at
```

Registration Intent 会过期，并在较短的运维保留期后物理删除。使用已经存在且已验证的联系方式开始注册时，对外返回相同响应，但不会创建新凭据或更改该账号。对尚未消费的 Intent 再次发起注册时，只有通过重发和速率限制后才能替换之前的 Challenge；这一操作绝不修改密码。

最终 Migration 必须实现上述外键、枚举或 Check Constraint、Partial Index 和原子消费条件。消费 Challenge 时使用条件更新，要求 `consumed_at IS NULL`、`invalidated_at IS NULL`、尚未过期且仍有剩余尝试次数。带密钥哈希包含 `hash_key_id`，从而在受控密钥轮换期间继续验证 Secret。在已停用邮箱或被回收手机号可用于识别其他用户之前，必须定义明确的冷却期和支持流程。

## HTTP 契约

所有路由都位于 `/api/auth` 下。响应遵循项目的 Problem Details 约定，并使用稳定、机器可读的错误码。在可能泄露账号是否存在时，注册、登录、验证请求和密码重置请求应返回通用响应。

### 注册与本地认证

| 方法与路由                          | 请求                                                  | 结果                                                                                                                                   |
| ----------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /registrations/email`         | `email`                                               | 创建或安全恢复符合条件的 Registration Intent，并将邮件加入队列。始终返回 `202`，且不接受密码。                                         |
| `GET /registrations/email/callback` | `token`                                               | 原子验证邮箱 Intent，设置短期有效的 `__Host-registration` Cookie，并重定向到已经移除 Token 的固定完成页面。                            |
| `POST /registrations/phone`         | `phone`                                               | 创建或安全恢复符合条件的 Intent，并将 SMS OTP 加入队列。始终返回 `202`；符合条件时返回不透明 `challengeId`，否则返回结构相同的诱饵值。 |
| `POST /registrations/phone/verify`  | `challengeId`、`code`                                 | 验证手机 Intent，并设置短期有效的 Registration Cookie。                                                                                |
| `GET /registration-session`         | Registration Cookie                                   | 返回安全的已验证注册元数据和 Registration CSRF Token。                                                                                 |
| `POST /registrations/complete`      | Registration Cookie + CSRF、`password`、`displayName` | 原子创建用户、已验证联系方式、凭据和 Session，并消费 Intent。                                                                          |
| `POST /login/password`              | `identifier`、`password`                              | 接受已验证邮箱或手机号；失败时统一返回一种凭据错误；成功时创建新的已轮换 Session。                                                     |
| `POST /password/reset/request`      | `identifier`                                          | 始终返回 `202`；仅为符合条件的已验证联系方式将恢复消息加入队列。                                                                       |
| `POST /password/reset/confirm`      | `token` 或 `challengeId` + `code`、`newPassword`      | 原子更新哈希、消费并作废 Reset、撤销全部 Session、清除锁定状态并写入审计事件。之后必须正常登录。                                       |
| `POST /password/change`             | 当前密码、新密码、Session + CSRF                      | 要求近期认证，更新哈希并轮换当前 Session；可选择撤销调用者的其他 Session。                                                             |

邮箱 Callback 必须禁止在访问日志中记录 Query String，设置 `Referrer-Policy: no-referrer`，单次消费 Token，并立即重定向到干净 URL。Registration Cookie 是不透明的、设置 `HttpOnly`、短期有效、绑定到已验证 Intent，且完成注册后无法再使用。

### 外部认证与账号绑定

| 方法与路由                                | 请求                                       | 结果                                                                                                               |
| ----------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `POST /external/:provider/start`          | Intent（`sign_in`）、经过校验的 `returnTo` | 创建一次性 State/PKCE Transaction，并返回 Provider Authorization URL；前端跳转到该地址。                           |
| `GET /external/:provider/callback`        | Provider `code`、`state`                   | 校验并消费 Transaction、解析 Provider Identity、按规则创建或绑定账号、创建 Session，并重定向到白名单中的干净 URL。 |
| `POST /external/:provider/link/start`     | Session + CSRF + 近期认证                  | 创建绑定到当前用户的 Transaction，并返回 Authorization URL。                                                       |
| `DELETE /external-identities/:identityId` | Session + CSRF + 近期认证                  | 仅在仍保留其他可用认证方式时解除身份绑定。                                                                         |

首个具体 OAuth Profile Adapter 是微信开放平台网站扫码登录。必须完整配置 `WECHAT_PROVIDER_KEY`、`WECHAT_APP_ID` 和 `WECHAT_APP_SECRET`，配置不完整会使应用启动失败。Adapter 使用 `snsapi_login`，只允许 API 在服务端交换 Code 和请求 Profile，并在完成后丢弃 Provider Token。Identity Key 使用网站 AppID 作用域加 OpenID。UnionID 存在时只进行一致性校验；跨应用账号统一需要 ADR 0004 定义的额外模型和冲突策略。公众号、小程序和原生应用登录属于不同的后续 Adapter。

### Session 与联系方式

| 方法与路由                    | 请求                                | 结果                                                            |
| ----------------------------- | ----------------------------------- | --------------------------------------------------------------- |
| `GET /session`                | Session Cookie                      | 返回当前用户、安全的 Session 元数据和 Synchronizer CSRF Token。 |
| `POST /logout`                | Session + CSRF                      | 撤销当前 Session 并清除对应 Cookie。                            |
| `GET /sessions`               | Session Cookie                      | 列出调用者的活跃 Session。                                      |
| `DELETE /sessions/:id`        | Session + CSRF                      | 撤销属于调用者的一条 Session。                                  |
| `POST /contacts/email`        | 新邮箱、Session + CSRF + 近期认证   | 开始验证，但不修改当前主要联系方式。                            |
| `POST /contacts/phone`        | 新手机号、Session + CSRF + 近期认证 | 开始验证，但不修改当前主要联系方式。                            |
| `POST /contacts/:id/verify`   | Token 或 Challenge ID + Code        | 验证待添加的联系方式。                                          |
| `PATCH /contacts/:id/primary` | Session + CSRF + 近期认证           | 将该类型中一个已验证联系方式提升为主要联系方式。                |
| `DELETE /contacts/:id`        | Session + CSRF + 近期认证           | 只有在账号仍保留可用恢复和登录方式时，才停用该联系方式。        |

注册开始和密码重置请求可以接受 `Idempotency-Key`，但幂等性不是滥用防护。速率限制和发送配额独立生效。`returnTo` 必须是相对路径或精确匹配的配置白名单项，绝不能选择任意 Origin。

## 认证流程

### 邮箱或手机号注册

1. 校验并规范化联系方式，然后在发送前应用 IP、联系方式哈希、设备、重发和 Provider 费用限制。
2. 在一个事务中创建或安全恢复 `registration_intent`、单次有效 Challenge 和 Outbox Event。此时不创建用户或密码凭据。
3. Worker 发送邮箱链接或 SMS OTP。已有账号得到相同的公开 API 响应，且不会被修改。
4. Challenge 确认以原子方式证明 Intent，并通过 Registration Cookie 签发短期有效的完成 Secret。此时不会创建已认证的用户 Session。
5. 完成注册需要已验证的 Registration Cookie、允许的 `Origin`、CSRF 证明、显示名称和有效新密码。系统在同一个事务中创建用户、已验证联系方式、密码凭据、审计事件、Outbox Event 和浏览器 Session，然后永久消费该 Intent。
6. 已过期、重放、已作废、超过尝试次数或已经消费的 Challenge，都要求重新发起符合条件的注册。

这一顺序可防止账号预劫持：用户点击一封非本人发起的邮件时，不会激活攻击者之前选择的密码。

### 外部登录

1. 只解析已配置的 Provider。创建短期有效的 Transaction，其中包含随机 `state`、PKCE Verifier、Provider Key、Intent、过期时间和白名单 Return Target。OIDC Transaction 还包含 `nonce`。将 Transaction 绑定到经过签名/加密的临时 `__Host-` Cookie。
2. Callback 单次消费 State，并在服务端交换 Code。OIDC Adapter 校验 Issuer、Audience、签名/JWKS、过期时间、Nonce、Subject，以及适用时的 Authorized-party Claim。OAuth Profile Adapter 校验 Token Response，并从 Provider 的认证 Profile Endpoint 获取稳定的 Provider User ID。
3. 如果 `(provider_key, provider_subject)` 已绑定，则拒绝 Disabled User，否则为已绑定用户创建已轮换 Session。
4. 如果是新 Identity，且受信任的 Provider Email 对应已有的已验证联系方式，则创建短期 Link Intent，并要求认证该现有账号。此时不创建第二个用户，也不绑定 Provider。
5. 如果没有冲突，则原子创建新用户和 External Identity。Provider Profile 字段只能作为可选显示默认值，不能作为授权数据。只有经过产品自身显式验证或明确的 Provider Trust Policy 后，Provider Email 才能成为登录联系方式。
6. 清除 Transaction、记录 Authentication Event、丢弃仅用于登录的 Provider Token、轮换 BFF Session，并且只重定向到已存储的 Return Target。

微信网站登录把 Transaction 存储在 `oauth_profile_transactions` 中；浏览器只保存独立的 Binding Secret。由于微信通过跨站顶层导航返回，外部 Callback Cookie 使用 `SameSite=Lax`，最终应用 Session 仍使用 `SameSite=Strict`。固定 Provider Host、拒绝重定向、十秒超时、有界 Response Body、OpenID 一致性、可选 UnionID 一致性以及数据库 Compare-and-set 消费共同保护 Provider 边界。Provider Nickname 只能用于显示；微信登录不会建立经过应用验证的邮箱或手机联系方式。

## 密码策略

- 未使用 MFA 保护密码登录时，默认至少要求 15 个 Unicode 字符；允许至少 64 个字符，并设置一个有文档记录的更高输入上限以防资源耗尽。
- 允许 Unicode、空格、粘贴和密码管理器。不要设置字符组合规则，不要静默截断，也不要要求定期修改密码。
- 拒绝常见或已泄露密码，且绝不将明文密码发送到应用日志或分析系统。
- 保存包含参数的 Argon2 编码哈希；成功登录后，如果当前策略更强，则重新哈希。
- 限制并发 Argon2 工作，避免密码攻击耗尽 API 内存。使用通用失败响应，并同时按账号和来源限流；不要把永久账号锁定作为主要控制手段。

## Session 与 CSRF 契约

- 生产 Session Cookie 命名为 `__Host-session`，使用 `Secure; HttpOnly; Path=/`，且不设置 `Domain`。优先使用 `SameSite=Strict`；只有在明确记录的跨站顶层导航确有需要时才使用 `Lax`。OIDC/OAuth Transaction 使用单独的短期 Cookie。
- Session 同时具有绝对生命周期和空闲生命周期。以有界时间间隔更新 `last_seen_at`，而不是每次请求都写数据库。过期、已撤销、Disabled User 和凭据已失效的 Session 必须 Fail Closed。
- `GET /api/auth/session` 返回与服务端 Session 关联、可由浏览器读取的 Synchronizer CSRF Token。所有使用 Cookie 认证的写操作都通过 `X-CSRF-Token` 提交它；API 还要校验 `Origin`，并在适当场景校验 `Sec-Fetch-Site`/`Referer`。
- 在认证、权限变更、密码变更、身份/联系方式变更、恢复和可疑活动后轮换 Session Secret。轮换必须原子地使旧 Secret 失效。
- 密码恢复会撤销每个活跃 Session，包括执行恢复的浏览器中可能存在的 Session。管理员禁用和撤销全部 Session 的操作在下一个请求时生效。

## 安全与滥用控制

- 认证端点必须运行在 TLS 后方，执行严格的 CORS Origin 白名单，应用安全 Header，并且不缓存包含 Secret 的认证响应。
- 根据场景分别按 IP Prefix、联系方式哈希、User ID、Challenge、Session/设备和消息 Provider 预算限流。只有观察到实际滥用时，才升级到 CAPTCHA 或 Risk Scoring。
- 对账号敏感的响应 Body 和有意义的响应耗时应尽量保持一致，以减少账号枚举。已经证明控制某个联系方式的用户，可以获得更具体的恢复指导。
- 以密码学安全方式生成 Token 与 OTP。Token 具有高熵；OTP 短期有效、限制尝试次数，并且只能与不透明 Challenge ID 一起校验。二者都不能出现在日志、分析、Trace、Referrer 或错误报告中。
- 修改凭据、主要联系方式、External Identity、MFA 或执行删除时，必须进行近期认证。安全敏感变更后通知已有的已验证联系方式，但通知中不得包含 Secret。
- 永远不能删除最后一种可用的登录和恢复方式。SMS 只能视为存在 SIM Swap 和号码回收风险的持有证明，不能视为抗钓鱼 MFA。
- 持久记录认证、验证、恢复、Session 撤销、联系方式变更、身份绑定和管理操作的 Audit Event。联系方式需要掩码或哈希，且绝不记录密码、Authorization Code、Token、Cookie 或完整恢复 URL。
- Provider Client Secret 和 HMAC Key 存放在生产 Secret Manager 中。带密钥哈希 Secret 的轮换使用明确的 Active/Verification Key ID 和重叠密钥流程。

## 授权集成

认证解析得到 `CurrentActor`，其中包含 `userId`、`sessionId`、认证时间、认证方式和选定的组织上下文。认证本身不授予租户访问权限。组织成员关系和领域 Policy 仍然是每个 Use Case、Worker Job 和管理命令的权威来源。

每个基于 Session 的请求都检查 `status=disabled`，而不只是在登录时检查。管理控制面只有在具备更强授权、近期 MFA、操作理由和审计记录时，才可以禁用用户或撤销全部 Session。

## 交付计划与验收测试

1. 添加 PostgreSQL/Prisma、仅向前 Migration、上述数据表与约束、Argon2id Adapter、Session/CSRF 支持、Provider Port、消息发送 Port 和 Outbox Job。
2. 交付经过邮箱验证的注册、密码登录、退出登录、Session 撤销、密码修改和恢复。
3. 使用真实 SMS Provider 添加手机注册/恢复，并实现国家/地区策略、费用限制、号码回收策略和发送监控。
4. 通过 `OidcIdentityProvider` 添加一个符合标准的 OIDC Provider；微信网站扫码登录使用专用 OAuth Profile Adapter，其他非 OIDC Provider 只能通过经过 Review 的专用 Adapter 接入。
5. 按风险逐步添加联系方式管理、显式 External Identity 绑定、Passkey 和特权操作 Step-up Authentication。

必须覆盖的自动化测试包括：规范化和唯一性竞争；注册预劫持尝试；Pending Intent 过期与清理；密码验证与重新哈希；过期、重放或超过尝试次数的 Challenge；抗枚举响应；重发与速率限制；Session 轮换、空闲/绝对过期和撤销；CSRF 与 Login CSRF 尝试；OIDC State/Nonce/PKCE/Issuer/Audience 失败；OAuth Profile 替换攻击；External Email 冲突且不隐式绑定；最后一种登录方式保护；Disabled User 拒绝；登录后的租户隔离；密码恢复竞争；Outbox 重试；以及审计/日志脱敏。

## 实现前仍需决定的事项

- 为每个启用的 Provider 准备生产凭据、精确 Callback URL/Domain、最小 Scope、测试账号、可用性监控、凭据轮换流程和发布验证 Runbook。
- 选择邮件和 SMS Provider、支持国家/地区、Sender Identity、模板、费用保护和降级行为。
- 决定首发版本是否必须支持手机注册，因为 SMS 会带来成本、送达率、SIM Swap、号码回收和区域合规责任。
- 在可部署配置中定义具体的 Session、注册、验证、OTP、恢复、重发和近期认证有效期。
- 定义联系方式停用/复用、账号保留、身份删除、Legal Hold 和数据导出策略。
- 决定管理员和高风险操作从何时开始强制使用 Passkey 或其他 MFA。
