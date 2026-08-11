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

---

# API 约定（中文版）

第一方 Web 应用使用 `/api`。当独立发布的客户端或第三方开始依赖兼容性时，单独进行版本管理的公共 API 使用 `/v1`。

- 使用复数形式的资源名称，仅在父级作用域确有必要时嵌套路由。
- 使用专用 DTO 校验每个请求。数据库模型不是 API 模型。
- 列表响应使用游标分页：`data`、`nextCursor`，以及可选的 `meta`。
- 时间戳使用 ISO 8601 UTC 字符串。金额使用整数最小货币单位或十进制字符串，绝不使用 JavaScript 浮点数。
- 错误响应使用 RFC 9457 Problem Details，并包含稳定、机器可读的应用错误码。
- 必须容忍网络重试的写操作需要幂等键，并按租户、Actor/客户端和操作划分作用域。
- 并发编辑使用资源版本或 ETag；提交过期版本时返回 `409 Conflict` 或 `412 Precondition Failed`。
- 公共 API 上线后，从运行中的应用生成 OpenAPI，并在 CI 中检查破坏性变更。
