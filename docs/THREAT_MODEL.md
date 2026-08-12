# Current Threat Model

This is the baseline threat model. Each sensitive feature adds a focused entry with its assets, actors, trust boundaries, abuse cases, and mitigations.

## Assets

- Customer and organization data.
- Browser sessions and identity-provider tokens.
- Configuration secrets and production credentials.
- Uploaded objects and exported files.
- Audit records, queues, and availability.

## Trust boundaries

- Browser to CDN/reverse proxy to API.
- API and Worker to PostgreSQL, Redis, object storage, and identity provider.
- CI to the artifact registry and deployment platform.
- Administrator/CLI access to operational actions.

## Baseline mitigations

| Threat                   | Baseline mitigation                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Invalid or hostile input | DTO validation, body limits, stable error responses, and no raw ORM errors.                                                                |
| Credential/session theft | BFF authentication boundary, Argon2id password hashes, opaque `HttpOnly` sessions, CSRF controls, secret redaction, and rotation.          |
| Cross-tenant access      | Application-level policy checks using actor and tenant context; HTTP guards are not the sole control.                                      |
| Secret exposure          | Environment validation, `.env` exclusion, secret manager in production, log redaction, and CI secret scanning.                             |
| Dependency compromise    | Lockfile, Dependabot updates, dependency/image scanning, and SBOM generation in release CI.                                                |
| Queue/cache data loss    | Separate cache and BullMQ Redis deployments; queue Redis uses `noeviction`; durable side effects originate from PostgreSQL outbox records. |
| Untrusted file delivery  | Private buckets, quarantine/scan state machine, short-lived authorized download URLs.                                                      |
| Operational misuse       | Audited CLI/admin actions, least privilege, MFA for privileged access, and break-glass procedures.                                         |

## Identity and delivery controls

- Password verification uses bounded-concurrency Argon2id work and a dummy hash for unknown identifiers. Public registration and reset responses are generic and have a minimum randomized response duration.
- Production and staging use `__Host-` cookies with `Secure`, `HttpOnly`, `Path=/`, and no `Domain`. Cookie-authenticated mutations require both an allowed `Origin` and a session-bound CSRF token.
- Email links, phone OTPs, reset tokens, session secrets, OIDC state, PKCE verifiers, and nonces are single-use, expiring, hashed or authenticated-encrypted values. Authentication responses use `Cache-Control: no-store` and logs redact cookies, authorization headers, passwords, and tokens.
- Phone OTP delivery is disabled until a complete Twilio configuration is provided. E.164 normalization, resend cooldowns, hourly send bounds, OTP attempt bounds, and generic decoy challenge responses reduce abuse and enumeration risk. SMS remains vulnerable to SIM swaps and number recycling and is not treated as phishing-resistant MFA.
- Durable email/SMS side effects are written to PostgreSQL in the same transaction as their intent. The Worker uses compare-and-set claiming, stale-lock recovery, bounded exponential retries, a dead state, stable email message IDs, and payload redaction after delivery.
- OIDC uses Authorization Code with PKCE, state, nonce, exact callback origins, browser binding, encrypted transaction secrets, safe relative return targets, and one-time transaction consumption. Provider email claims never cause implicit account linking.

## Current limitations and follow-up controls

- OIDC and SMS providers are optional and must be configured and operationally monitored before their routes are offered to users. Explicit external-identity linking, verified-contact management, provider-email collision recovery, passkeys, and privileged step-up authentication remain follow-up identity work.
- The outbox processor is an intentionally small PostgreSQL poller. BullMQ generalization, queue dashboards, replay tooling, delivery-provider webhooks, retention jobs, and alerting remain Milestone 3 work.
- Object upload, quarantine/scanning, webhooks, an administrative control plane, secret-manager integration, artifact signing/SBOM publication, and production deployment automation are not implemented yet. Their baseline entries above are requirements, not claims of completed controls.

---

# 当前威胁模型（中文版）

这是基线威胁模型。每项敏感功能都要补充聚焦于自身的条目，说明资产、Actor、信任边界、滥用场景和缓解措施。

## 资产

- 客户与组织数据。
- 浏览器 Session 和身份提供商 Token。
- 配置 Secret 和生产凭据。
- 上传对象和导出文件。
- 审计记录、队列和服务可用性。

## 信任边界

- 浏览器到 CDN/反向代理，再到 API。
- API 和 Worker 到 PostgreSQL、Redis、对象存储及身份提供商。
- CI 到制品仓库和部署平台。
- 管理员/CLI 对运维操作的访问。

## 基线缓解措施

| 威胁                | 基线缓解措施                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| 无效或恶意输入      | DTO 校验、Body 大小限制、稳定的错误响应，且不暴露原始 ORM 错误。                                             |
| 凭据/Session 被窃取 | BFF 认证边界、Argon2id 密码哈希、不透明 `HttpOnly` Session、CSRF 控制、Secret 脱敏和轮换。                   |
| 跨租户访问          | 使用 Actor 和租户上下文执行应用层策略检查；HTTP Guard 不是唯一防线。                                         |
| Secret 泄露         | 环境配置校验、排除 `.env`、生产 Secret Manager、日志脱敏和 CI Secret 扫描。                                  |
| 依赖遭到入侵        | 锁文件、Dependabot 更新、依赖/镜像扫描，以及发布 CI 中生成 SBOM。                                            |
| 队列/缓存数据丢失   | 缓存 Redis 与 BullMQ Redis 分开部署；队列 Redis 使用 `noeviction`；持久副作用来源于 PostgreSQL Outbox 记录。 |
| 不可信文件交付      | 私有 Bucket、隔离/扫描状态机，以及短期有效且经过授权的下载 URL。                                             |
| 运维操作被滥用      | 经过审计的 CLI/管理操作、最小权限、特权访问 MFA 和紧急 Break-glass 流程。                                    |

## 身份与投递控制

- 密码校验使用具有并发上限的 Argon2id 计算，并为未知 Identifier 使用 Dummy Hash。公开注册与重置接口使用通用响应，并保证带随机抖动的最短响应时间。
- Production 与 Staging 使用带 `Secure`、`HttpOnly`、`Path=/` 且不含 `Domain` 的 `__Host-` Cookie。所有基于 Cookie 认证的写操作都同时要求允许的 `Origin` 和绑定 Session 的 CSRF Token。
- 邮件链接、手机 OTP、重置 Token、Session Secret、OIDC State、PKCE Verifier 和 Nonce 都是一次性、限时且经过哈希或认证加密的值。认证响应使用 `Cache-Control: no-store`；日志会脱敏 Cookie、Authorization Header、密码和 Token。
- 只有提供完整 Twilio 配置后才会启用手机 OTP 投递。E.164 规范化、重发冷却、每小时发送上限、OTP 尝试次数上限和通用诱饵 Challenge 响应用于降低滥用与枚举风险。SMS 仍然存在 SIM Swap 和号码回收风险，不能视为抗钓鱼 MFA。
- 可靠邮件/SMS 副作用与其 Intent 在同一个 PostgreSQL 事务中写入。Worker 使用 Compare-and-set 领取、过期锁恢复、有限指数退避重试、Dead 状态、稳定 Email Message ID，并在成功投递后脱敏 Payload。
- OIDC 使用带 PKCE、State、Nonce、精确 Callback Origin、浏览器绑定、加密事务 Secret、安全相对 Return Target 和一次性事务消费的 Authorization Code Flow。Provider Email Claim 永远不会触发隐式账号绑定。

## 当前限制与后续控制

- OIDC 与 SMS Provider 都是可选配置；向用户开放相关 Route 前，必须完成配置和运维监控。显式外部身份绑定、已验证联系方式管理、Provider Email 冲突恢复、Passkey 和特权操作 Step-up Authentication 仍属于后续身份工作。
- 当前 Outbox Processor 是刻意保持精简的 PostgreSQL Poller。BullMQ 通用化、Queue Dashboard、重放工具、投递 Provider Webhook、保留期 Job 和告警仍属于 Milestone 3。
- 对象上传、隔离/扫描、Webhook、管理控制面、Secret Manager 集成、制品签名/SBOM 发布以及生产部署自动化尚未实现。上方对应的基线条目是要求，并不代表控制已经完成。
