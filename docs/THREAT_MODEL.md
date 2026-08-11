# Milestone 0 Threat Model

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

## Milestone 0 limitations

Milestone 0 intentionally has no database connection, authentication implementation, queue processor, or file upload endpoint. Those features must add explicit threat-model updates before they are enabled.

---

# Milestone 0 威胁模型（中文版）

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

## Milestone 0 的限制

Milestone 0 有意不包含数据库连接、认证实现、队列处理器或文件上传端点。这些功能在启用前必须显式更新威胁模型。
