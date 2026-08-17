# User Notifications Module

This module provides durable, user-scoped in-app notifications and real-time reminders. It is deliberately not a chat system, email/SMS campaign engine, or native mobile push provider. PostgreSQL is the source of truth; Server-Sent Events (SSE) reduce UI latency, while normal list and count requests restore state after disconnects.

## Supported behavior

- Store notification kind, severity, title, body, safe application action, creation time, optional expiry, and read time.
- List active notifications newest-first using opaque cursor pagination.
- Return the active unread count independently or with every list page.
- Mark one notification or all notifications as read.
- Dismiss one notification or permanently clear all read notifications.
- Stream new notifications and unread-count changes to the signed-in browser over SSE.
- Create reliable notifications from business transactions through the PostgreSQL transactional outbox.
- Deduplicate at-least-once outbox delivery with a recipient-scoped deduplication key.

An expired notification is excluded from lists and unread counts. It remains stored until a retention job removes it; expiry is a visibility rule, not an immediate deletion guarantee.

## Data and delivery flow

```text
Business transaction
  -> business row + notification.create outbox row (one PostgreSQL transaction)
  -> Worker claims the outbox row
  -> notifications row (unique userId + dedupeKey)
  -> connected API instances find it during the five-second reconciliation window
  -> recipient SSE stream

Direct, in-process producer
  -> NotificationsService.create()
  -> notifications row
  -> local recipient SSE stream
```

The organization-membership flow is the first real producer. Adding an active user to an organization commits the membership, audit event, and `notification.create` event atomically. The Worker validates the event again, ignores inactive recipients and already-expired messages, inserts idempotently, marks the outbox event delivered, and redacts its payload.

## API contract

All routes require an active opaque browser session. Mutation routes also require an allowed `Origin` and the current session's `X-CSRF-Token`.

| Method   | Route                                     | Behavior                                       |
| -------- | ----------------------------------------- | ---------------------------------------------- |
| `GET`    | `/api/notifications`                      | Cursor-paginated list and current unread count |
| `GET`    | `/api/notifications/unread-count`         | Current active unread count                    |
| `GET`    | `/api/notifications/stream`               | Recipient-scoped SSE connection                |
| `PATCH`  | `/api/notifications/:notificationId/read` | Idempotently mark one notification read        |
| `PATCH`  | `/api/notifications/read-all`             | Mark all of the actor's notifications read     |
| `DELETE` | `/api/notifications/:notificationId`      | Dismiss one notification                       |
| `DELETE` | `/api/notifications/read`                 | Permanently delete all read notifications      |

List query parameters:

- `limit`: `1` to `100`, default `20`.
- `cursor`: opaque cursor returned by the previous page.
- `unreadOnly`: `true` or `false`, default `false`.

Example response:

```json
{
  "data": [
    {
      "id": "7d1e5e7b-0bb3-4a88-a123-a0221ba57fe9",
      "kind": "organization.member.added",
      "severity": "SUCCESS",
      "title": "Organization access granted",
      "body": "You were added to Example as MEMBER.",
      "actionUrl": "/organizations/7eaa29a5-27f6-4a98-a8cb-e84d7657379d",
      "readAt": null,
      "expiresAt": null,
      "createdAt": "2026-08-17T08:00:00.000Z"
    }
  ],
  "nextCursor": null,
  "meta": { "unreadCount": 1 }
}
```

Internal `userId` and `dedupeKey` values are never returned by the user-facing API.

## SSE client contract

The stream emits these named events:

| Event             | Meaning                                                                       |
| ----------------- | ----------------------------------------------------------------------------- |
| `snapshot`        | Initial unread-count snapshot; clients should also fetch the current list.    |
| `notification`    | A newly observed notification with the same public shape as a list item.      |
| `unread-count`    | The unread count changed.                                                     |
| `heartbeat`       | Keeps intermediaries and idle connections alive.                              |
| `resync-required` | Replay, reconciliation, or initialization was incomplete; refetch list/count. |

Browsers reconnect `EventSource` automatically and send `Last-Event-ID` for the last notification event. The server replays at most 100 later records. It also reconciles PostgreSQL every five seconds, which covers Worker inserts and read-state changes handled by another API replica. Clients must still treat `GET /api/notifications` and `GET /api/notifications/unread-count` as authoritative after reconnect, `resync-required`, page focus, or a suspicious count.

For cross-origin browser deployments, construct `EventSource` with credentials and retain the configured CORS origin. SSE is one-way by design; read and clear actions remain ordinary CSRF-protected HTTP mutations.

## Authorization and security invariants

- The recipient is always derived from the authenticated session for reads and mutations. No user-facing route accepts a target `userId`.
- Every database read, update, and delete includes the actor's `userId`. A valid notification ID belonging to another user returns `404`, which avoids confirming its existence.
- The SSE subscription is established only after session validation and only receives events routed to that user.
- Notification creation is an internal service/outbox capability, not a public user endpoint.
- Notification content is plain text with bounded lengths. Render title and body as text, not unsanitized HTML.
- `actionUrl` must be a relative application path; protocol-relative URLs, backslashes, and arbitrary external redirects are rejected.
- Producers must not put passwords, tokens, OTP values, provider secrets, or unnecessary personal data in notification text or deduplication keys.
- The unique `(userId, dedupeKey)` constraint is the final defense against retries and concurrent duplicate delivery.
- Mutations use `private, no-store`; the SSE route disables proxy buffering and transformation.

## Producer rules

Use `NotificationsService.create()` only when the notification does not need to be atomic with another durable change. When a notification represents a committed business event, write a `notification.create` outbox row in the same database transaction.

Each durable producer must provide a stable, event-specific deduplication key, for example `organization.member.added:<membershipId>`. Titles and bodies are display text, not identifiers. Consumers should branch on `kind`, never parse the human-readable body.

## Operations and future channels

Monitor outbox pending/dead counts, SSE connection/error rates, notification insert failures, reconciliation failures, and list/count latency. Add a scheduled retention job before operating at large scale; define separate retention windows for read and expired records according to product and compliance needs.

Web Push, APNs, Android push, WeChat template/subscription messages, and email/SMS reminders are future delivery channels. They should consume the same domain event or channel preference decision, but each needs consent, unsubscribe/preferences, provider tokens, retry policy, quiet hours, rate limits, and privacy review. They must not replace the durable in-app record when the product requires an inbox.

---

# 用户通知模块（中文版）

本模块提供持久化、用户范围内的站内通知和实时提醒。它不是聊天系统、邮件/SMS 营销引擎，也不是原生移动推送 Provider。PostgreSQL 是最终事实来源；Server-Sent Events（SSE）用于降低界面更新延迟，普通列表和未读数请求则负责在断线后恢复正确状态。

## 已支持行为

- 保存通知类型、级别、标题、正文、安全的站内跳转地址、创建时间、可选过期时间与已读时间。
- 按从新到旧顺序，通过不透明 Cursor 分页列出有效通知。
- 独立返回有效未读数，也会在每一页列表中返回当前未读数。
- 将一条通知或全部通知标记为已读。
- 清除单条通知，或永久清除全部已读通知。
- 通过 SSE 向已登录浏览器推送新通知与未读数变化。
- 通过 PostgreSQL 事务 Outbox，从真实业务事务中可靠地产生通知。
- 使用接收者范围的去重 Key，对 At-least-once Outbox 投递进行幂等去重。

过期通知不会出现在列表或未读数中，但会保留到 Retention Job 将其删除；过期是可见性规则，不保证立即物理删除。

## 数据与投递流程

```text
业务事务
  -> 业务数据行 + notification.create Outbox 行（同一个 PostgreSQL 事务）
  -> Worker 领取 Outbox 行
  -> notifications 数据行（userId + dedupeKey 唯一）
  -> 已连接的 API 实例在 5 秒对账窗口内发现它
  -> 接收者 SSE Stream

进程内直接 Producer
  -> NotificationsService.create()
  -> notifications 数据行
  -> 本实例上的接收者 SSE Stream
```

Organization Membership 是首个真实 Producer。把 Active 用户加入 Organization 时，会原子提交 Membership、Audit Event 和 `notification.create` Event。Worker 再次校验 Event，忽略 Inactive 接收者与已经过期的消息，以幂等方式插入通知，将 Outbox Event 标记为已投递，并脱敏其 Payload。

## API 契约

所有 Route 都要求有效的不透明浏览器 Session。写操作还要求允许的 `Origin`，以及当前 Session 对应的 `X-CSRF-Token`。

| 方法     | Route                                     | 行为                              |
| -------- | ----------------------------------------- | --------------------------------- |
| `GET`    | `/api/notifications`                      | Cursor 分页列表和当前未读数       |
| `GET`    | `/api/notifications/unread-count`         | 当前有效未读数                    |
| `GET`    | `/api/notifications/stream`               | 仅属于当前接收者的 SSE 连接       |
| `PATCH`  | `/api/notifications/:notificationId/read` | 幂等地将一条通知标记为已读        |
| `PATCH`  | `/api/notifications/read-all`             | 将当前 Actor 的全部通知标记为已读 |
| `DELETE` | `/api/notifications/:notificationId`      | 清除一条通知                      |
| `DELETE` | `/api/notifications/read`                 | 永久删除全部已读通知              |

列表 Query 参数：

- `limit`：`1` 到 `100`，默认 `20`。
- `cursor`：上一页返回的不透明 Cursor。
- `unreadOnly`：`true` 或 `false`，默认 `false`。

响应示例：

```json
{
  "data": [
    {
      "id": "7d1e5e7b-0bb3-4a88-a123-a0221ba57fe9",
      "kind": "organization.member.added",
      "severity": "SUCCESS",
      "title": "Organization access granted",
      "body": "You were added to Example as MEMBER.",
      "actionUrl": "/organizations/7eaa29a5-27f6-4a98-a8cb-e84d7657379d",
      "readAt": null,
      "expiresAt": null,
      "createdAt": "2026-08-17T08:00:00.000Z"
    }
  ],
  "nextCursor": null,
  "meta": { "unreadCount": 1 }
}
```

面向用户的 API 永远不会返回内部 `userId` 和 `dedupeKey`。

## SSE 客户端契约

Stream 会发送以下命名 Event：

| Event             | 含义                                                           |
| ----------------- | -------------------------------------------------------------- |
| `snapshot`        | 初始未读数快照；客户端还应主动获取当前列表。                   |
| `notification`    | 新发现的通知，结构与列表项相同。                               |
| `unread-count`    | 未读数发生变化。                                               |
| `heartbeat`       | 保持中间代理和空闲连接存活。                                   |
| `resync-required` | Replay、对账或初始化未完整完成；客户端应重新请求列表和未读数。 |

浏览器会自动重连 `EventSource`，并为最后收到的通知 Event 发送 `Last-Event-ID`。服务端最多 Replay 后续 100 条记录，同时每五秒与 PostgreSQL 对账，以覆盖 Worker 插入，以及由其他 API Replica 处理的已读状态变化。客户端在重连、收到 `resync-required`、页面重新获得焦点或发现计数可疑时，仍必须把 `GET /api/notifications` 和 `GET /api/notifications/unread-count` 视为权威结果。

跨域浏览器部署应使用带凭据的 `EventSource`，并保留已配置的 CORS Origin。SSE 按设计只支持单向传输；已读和清除仍使用受 CSRF 保护的普通 HTTP 写操作。

## 授权与安全不变量

- 读取和写操作的接收者始终来自已认证 Session。面向用户的 Route 不接受目标 `userId`。
- 每条数据库查询、更新和删除都包含 Actor 的 `userId`。即使 Notification ID 有效但属于其他用户，也返回 `404`，从而避免确认资源是否存在。
- 只有在 Session 校验成功后才建立 SSE 订阅，并且只接收路由给该用户的 Event。
- 创建通知属于内部 Service/Outbox 能力，不提供公开的用户创建接口。
- 通知内容是长度受限的纯文本。前端必须按文本渲染标题和正文，不能当作未经清理的 HTML。
- `actionUrl` 必须是相对站内路径；协议相对 URL、反斜杠和任意外部重定向都会被拒绝。
- Producer 不得把密码、Token、OTP、Provider Secret 或不必要的个人信息写入通知文本或去重 Key。
- 唯一 `(userId, dedupeKey)` 约束是针对重试和并发重复投递的最终防线。
- 写操作使用 `private, no-store`；SSE Route 禁止代理缓冲和内容转换。

## Producer 规则

只有在通知不需要与其他持久化修改保持原子性时，才使用 `NotificationsService.create()`。当通知代表已提交的业务事件时，应在同一个数据库事务中写入 `notification.create` Outbox 行。

每个可靠 Producer 都必须提供稳定且属于该事件的去重 Key，例如 `organization.member.added:<membershipId>`。标题与正文只用于展示，不能作为标识符。Consumer 应根据 `kind` 分支处理，不能解析人类可读的正文。

## 运维与未来 Channel

应监控 Outbox Pending/Dead 数量、SSE 连接数与错误率、通知插入失败、对账失败，以及列表/计数延迟。在大规模运行前应增加定时 Retention Job，并按照产品与合规要求，为已读记录和过期记录分别定义保留周期。

Web Push、APNs、Android Push、微信模板/订阅消息、邮件/SMS 提醒属于未来投递 Channel。它们可以消费相同的 Domain Event 或 Channel Preference 决策，但每个 Channel 都需要用户授权、退订/偏好设置、Provider Token、重试策略、免打扰时段、限流和隐私评审。当产品要求站内收件箱时，这些外部 Channel 不能替代持久化站内通知。
