# API Conventions

The first-party web application uses `/api`. A separately versioned public API uses `/v1` once independently released clients or third parties depend on compatibility.

- Use plural resource names and nest routes only when the parent scope is required.
- Validate every request with a dedicated DTO. Database models are not API models.
- List responses use cursor pagination: `data`, `nextCursor`, and optional `meta`.
- Timestamps are ISO 8601 UTC strings. Money uses integer minor units or decimal strings, never JavaScript floating-point values.
- Error responses use RFC 9457 Problem Details with a stable machine-readable application error code.
- Mutations that must tolerate network retries require an idempotency key scoped by tenant, actor/client, and operation.
- Concurrent edits use a resource version or ETag and return `409 Conflict` or `412 Precondition Failed` on a stale write.
- OpenAPI is generated from the running application and checked for breaking changes in CI once a public API exists.
