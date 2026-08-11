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
| Credential/session theft | OIDC BFF flow, opaque `HttpOnly` sessions, CSRF controls, secret redaction, and rotation.                                                  |
| Cross-tenant access      | Application-level policy checks using actor and tenant context; HTTP guards are not the sole control.                                      |
| Secret exposure          | Environment validation, `.env` exclusion, secret manager in production, log redaction, and CI secret scanning.                             |
| Dependency compromise    | Lockfile, Dependabot updates, dependency/image scanning, and SBOM generation in release CI.                                                |
| Queue/cache data loss    | Separate cache and BullMQ Redis deployments; queue Redis uses `noeviction`; durable side effects originate from PostgreSQL outbox records. |
| Untrusted file delivery  | Private buckets, quarantine/scan state machine, short-lived authorized download URLs.                                                      |
| Operational misuse       | Audited CLI/admin actions, least privilege, MFA for privileged access, and break-glass procedures.                                         |

## Milestone 0 limitations

Milestone 0 intentionally has no database connection, authentication implementation, queue processor, or file upload endpoint. Those features must add explicit threat-model updates before they are enabled.
