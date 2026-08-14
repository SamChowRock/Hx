# API 契约、分页、幂等与兼容性

> [返回专家训练目录](README.md)

## 1. 目标

从“能返回 JSON”进阶到设计一个可长期演进的协议：

- 明确资源、Command 和状态码；
- 区分语法错误、认证、授权、冲突和不可用；
- 设计稳定分页与排序；
- 处理超时后的重复写入；
- 让新旧客户端和新旧服务版本共存。

## 2. Contract Checklist

每个 Endpoint 写清：

```text
Method / Path
Authentication
Authorization Action
Path / Query / Header / Body Schema
Success Response
Problem Codes
Idempotency
Concurrency Version
Rate/Size Limit
Audit
Pagination/Sorting
Compatibility Notes
```

## 3. Resource 与 Command

CRUD 风格：

```http
PATCH /projects/:id
{"status":"ARCHIVED"}
```

Command 风格：

```http
POST /projects/:id/archive
```

如果状态转换有专门权限、前置条件、Audit 和副作用，Command 常更清晰；通用字段编辑适合 PATCH。不要为了 REST 纯度隐藏业务语义。

## 4. Mandatory Lab A：稳定游标分页

把 Project List 改为：

```json
{
  "data": [],
  "nextCursor": "opaque-or-null"
}
```

要求：

- `limit` 1～100，默认 20；
- 排序 `createdAt DESC, id DESC`；
- Cursor 同时包含时间和 ID；
- Cursor 经过 Base64URL 编码并严格 Parse；
- 非法 Cursor 返回稳定 400 Code；
- Tenant Scope 永远存在；
- 插入新 Row 后翻页不重复、不跳过已有快照内 Row；
- 不暴露任意字段排序。

测试相同 `createdAt` 的多 Row，证明 ID Tie-breaker 必要。

## 5. Mandatory Lab B：Idempotency Key

新增模型概念：

```text
IdempotencyRecord
  organizationId
  actorUserId
  operation
  key
  requestHash
  state PROCESSING/SUCCEEDED
  responseStatus
  responseBody
  expiresAt
```

唯一 Scope：

```text
(organizationId, actorUserId, operation, key)
```

规则：

1. 第一次请求原子创建 PROCESSING；
2. 相同 Key + 不同 Request Hash → 409；
3. 相同 Key 已成功 → 返回相同 Status/Body；
4. 并发相同请求只有一个执行业务；
5. PROCESSING 陈旧需要恢复策略；
6. 记录有 TTL 和清理；
7. Response 不能包含不适合持久化的 Secret。

## 6. Request Hash

不要直接 Hash 原始 JSON 字符串，因为字段顺序和无意义空白会变化。先基于已经验证的 DTO 做稳定 Canonicalization：固定字段顺序、明确 null/省略语义，再 HMAC/Hash。

## 7. 幂等与数据库事务

业务创建和 Idempotency 成功结果最好在同一事务中提交；否则可能 Project 已创建而 Record 仍 PROCESSING。

如果响应生成依赖事务后数据，设计清楚中间状态与恢复流程。

## 8. 错误分类

建议稳定 Code：

| HTTP | Code                            | 客户端行为                  |
| ---- | ------------------------------- | --------------------------- |
| 400  | `INVALID_REQUEST`               | 修正输入，不自动重试        |
| 401  | `AUTH_REQUIRED`                 | 重新认证                    |
| 403  | `ORGANIZATION_ACTION_FORBIDDEN` | 隐藏/禁用功能，但后端仍权威 |
| 404  | `PROJECT_NOT_FOUND`             | 刷新资源                    |
| 409  | `PROJECT_VERSION_CONFLICT`      | 重新读取并解决冲突          |
| 409  | `IDEMPOTENCY_KEY_REUSED`        | 生成新 Key 或修复调用       |
| 429  | `RATE_LIMITED`                  | 按 Retry-After 退避         |
| 503  | `DEPENDENCY_UNAVAILABLE`        | 有上限重试/降级             |

## 9. Compatibility Lab

模拟旧前端只认识 `ACTIVE/ARCHIVED`，新后端增加 `DELETING`。回答：

- 旧前端 exhaustive switch 会怎样；
- API 是否应把新内部状态映射为旧公开状态；
- 是否需要 API Version；
- 如何用 Contract Test 阻止意外 Breaking Change。

## 10. OpenAPI 训练

当前 Zod Controller 的 OpenAPI 不完整。选择一种方案补齐 Project/Task：

- Zod → OpenAPI 集成；
- 显式 Swagger DTO；
- Build 时导出 JSON 并运行 Breaking Change Diff。

验收：请求、响应、Problem Schema、Cookie Auth、CSRF Header、Enum、分页都可见。

## 11. 并发与超时验收

- 同 Key 并发 20 次，只创建一个 Resource；
- 全部响应拥有相同 Resource ID；
- 相同 Key 不同 Body 返回 409；
- 模拟数据库 Commit 后响应中断，再发同 Key，返回原结果；
- Key 跨 Tenant/Actor 不互相影响；
- Expired Record 的语义明确。

## 12. 交付物

- API Contract 文档；
- Cursor Codec 和 Property Tests；
- Idempotency 模型、Service、E2E；
- OpenAPI Artifact；
- Breaking Change 报告；
- Client Retry 指南。
