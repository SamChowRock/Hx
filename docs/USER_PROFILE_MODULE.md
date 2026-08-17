# User Profile Module

## Purpose and scope

The profile module combines an authenticated user directory with a self-service editing surface. Signed-in Active users may read another Active user's shared profile, but the target independently controls whether biography, avatar, verified primary email, and verified primary phone are visible. Nickname remains the mandatory shared identity label. A user may edit only their own data and visibility settings, and only their self view exposes private fields and nickname-change quota information. Profiles are not internet-public and never expose credentials, session data, storage keys, or audit data. Social discovery, following, moderation queues, and account linking remain out of scope.

The persistent product account remains `User`. The existing `display_name` column is exposed as `nickname` by this API so existing identity/session consumers remain compatible. `bio`, the private avatar object key, and the avatar version timestamp live on the user record. `nickname_changes` stores only user ID and change time; it does not retain previous nicknames.

## Authorization boundary (critical)

The permission model separates readable profile data from writable account state:

| Capability                            | Permission                                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Read own full profile and quota       | Active authenticated session.                                                                  |
| Read another user's shared profile    | Active session; target is Active; each optional field is `AUTHENTICATED`.                      |
| Read another user's processed avatar  | Same rule, and the target's avatar visibility is `AUTHENTICATED`.                              |
| Update nickname, biography, or avatar | Own account only; target identity comes exclusively from the validated server-side session.    |
| Update field visibility               | Own account only; allowed Origin and matching session CSRF token are required.                 |
| Update another user                   | Denied by design; no such HTTP route exists and self-update bodies reject a supplied `userId`. |

The shared response is structurally allowlisted to `id`, `nickname`, `bio`, `avatarUrl`, `email`, and `phone`. Optional fields that the target has not shared are returned as `null`; the response never reveals whether a hidden contact exists. It excludes timestamps, login identities, non-primary or retired contacts, account status, nickname quota/history, visibility settings, object keys, and audit records. Inactive or unknown targets both return `404`, avoiding unnecessary account-state disclosure.

An absent, expired, revoked, or non-active actor session receives `401`. Every mutation additionally requires both an allowed `Origin` and the CSRF token bound to that same session; missing or mismatched CSRF authorization receives `403`. Both controller and service carry the trusted actor ID through shared reads. If anonymous, organization-scoped, support, or administrator access is added later, it must use a separate route and explicit policy check—never broaden these self-update handlers.

## HTTP contract

All endpoints require an active opaque browser session. Mutations additionally require an allowed `Origin` and the session CSRF token.

| Method and route                   | Request                                     | Result                                                                                          |
| ---------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `GET /api/profile`                 | Session cookie                              | Returns owner fields, visibility settings, timestamps, and current nickname-change quota.       |
| `PATCH /api/profile`               | CSRF; `nickname?`, `bio?`                   | Normalizes and atomically updates supplied fields. Empty biography text clears the biography.   |
| `PATCH /api/profile/visibility`    | CSRF; partial field-visibility object       | Independently updates the owner's biography, avatar, email, or phone visibility.                |
| `PUT /api/profile/avatar`          | CSRF; Multipart field `file`, maximum 5 MiB | Validates and re-encodes one image, replaces the private avatar, and returns the fresh profile. |
| `GET /api/profile/avatar`          | Session cookie; optional `If-None-Match`    | Proxies the private WebP avatar with an ETag and private cache policy.                          |
| `DELETE /api/profile/avatar`       | CSRF                                        | Removes the avatar reference and best-effort deletes the old object.                            |
| `GET /api/profiles/:userId`        | Session cookie                              | Returns the allowlisted shared fields for an Active target user.                                |
| `GET /api/profiles/:userId/avatar` | Session cookie; optional `If-None-Match`    | Proxies an Active target user's processed avatar.                                               |

Profile responses never expose the S3/MinIO bucket or object key. The `avatarUrl` contains an avatar update timestamp so the frontend can use ordinary image caching without showing an obsolete avatar after replacement.

## Field visibility and contact privacy

Each optional shared field uses `PRIVATE` or `AUTHENTICATED`. All four settings default to `PRIVATE`, including for accounts created before this feature. A partial update changes only the supplied fields, is serialized under the user's PostgreSQL row lock, and records `profile.visibility.changed`. Submitting unchanged settings is a no-op.

`AUTHENTICATED` means visible to Active signed-in users through the shared-profile routes; it does not mean anonymous internet access. Only a verified, non-retired contact is eligible, with the primary contact preferred when more than one exists. Visibility does not alter which email or phone is used for login, recovery, or notification delivery. Removing or retiring a contact makes it disappear from shared responses automatically. Publishing a contact increases phishing, spam, scraping, and unwanted-contact risk, so the frontend should explain the consequence and require an explicit opt-in for each field.

## Nickname policy

- Normalize input with Unicode NFKC, trim surrounding whitespace, and collapse internal whitespace runs to one space.
- Accept 1–16 Unicode code points and reject control characters. Nicknames are not globally unique.
- Permit at most three successful changes in any rolling 30-day window. Initial registration/provider nickname assignment is not a change.
- Updating to the already stored normalized nickname is a no-op and consumes no quota. Biography and avatar changes never consume nickname quota.
- Serialize nickname changes by locking the user's PostgreSQL row before counting and inserting the change record. Four concurrent requests therefore cannot all pass a stale count.
- When exhausted, return `429`, problem code `NICKNAME_CHANGE_LIMIT`, `retryAt`, and an HTTP `Retry-After` header. `GET /api/profile` also reports `limit`, `used`, `remaining`, and `nextChangeAllowedAt` so the UI can explain the rule before submission.

The rolling window is exactly 30 × 24 hours, not a calendar month. This is deterministic across month lengths and time zones. A future product-policy change must update the API contract and tests together.

## Biography policy

Biography input is normalized to NFC, line endings become `\n`, surrounding whitespace is removed, and the result is limited to 500 Unicode code points. Empty text and explicit `null` clear it. The value is plain text: clients must render it as text, not unsanitized HTML. Anonymous public rendering, links, mention parsing, abuse reporting, moderation, and discovery require a separate product/security design.

## Avatar security and lifecycle

The API accepts at most 5 MiB in memory, then Sharp decodes the bytes instead of trusting the filename or MIME header. Only single-page JPEG, PNG, and WebP inputs are accepted, with a 25-megapixel decode limit. The server applies orientation, crops/resizes to 512 × 512, strips source metadata, and writes a WebP result no larger than 1 MiB to a private S3-compatible bucket.

The object is stored under an opaque generated key. After storage succeeds, a PostgreSQL transaction locks the user, switches the reference, and writes an audit event. A database failure triggers best-effort deletion of the new object; a successful replacement triggers best-effort deletion of the prior object. Concurrent replacements are serialized at the database reference update, so the later update cleans the object it supersedes. Production still needs an object-inventory reconciliation job to remove rare orphans after storage/network failures.

Local development and tests may create a missing bucket automatically. Staging and production fail closed and require a pre-provisioned private bucket, HTTPS object-storage endpoint, non-local credentials, encryption/access policy, lifecycle rules, backups as appropriate, and monitoring. The owner avatar endpoint always permits the owner; the cross-user endpoint returns bytes only when avatar visibility is `AUTHENTICATED`. Anonymous or high-scale delivery later needs a separate privacy decision and normally a dedicated media origin or signed CDN URLs.

## Audit and observability

The module records `profile.nickname.changed`, `profile.bio.changed`, `profile.avatar.changed`, `profile.avatar.removed`, and `profile.visibility.changed`. Audit records intentionally do not copy biographies, nicknames, contacts, visibility values, object keys, image bytes, cookies, or CSRF tokens. Monitor 429 rates, invalid-image rejection, processing latency, object-storage failures, object deletion failures, and bucket capacity without logging user content.

---

# 用户 Profile 模块（中文版）

## 目的与范围

Profile 模块同时提供“登录用户目录”和“本人资料管理”能力。Active 登录用户可以读取其他 Active 用户的共享 Profile，但目标用户可以分别决定是否展示简介、头像、已验证 Primary 邮箱和已验证 Primary 手机号。昵称是始终共享的基础身份标签。用户只能修改本人的资料和可见性设置，并且只有本人视图会返回私有字段和昵称修改配额。Profile 不对互联网匿名公开，也绝不暴露凭据、Session、Storage Key 或 Audit 数据。社交发现、关注、审核队列和账号绑定仍不在本模块范围内。

持久产品账号仍然是 `User`。本 API 把已有 `display_name` 字段映射为 `nickname`，从而保持现有 Identity/Session Consumer 兼容。`bio`、私有头像 Object Key 和头像版本时间保存在 User Record 中。`nickname_changes` 只存 User ID 与修改时间，不保留历史昵称文本。

## 权限边界（重点）

权限模型明确区分“可读取的 Profile 数据”和“可修改的账号状态”：

| 能力                   | 权限                                                                             |
| ---------------------- | -------------------------------------------------------------------------------- |
| 读取本人完整资料和配额 | 有效的 Active 登录 Session。                                                     |
| 读取其他用户共享资料   | 有效的 Active Session；目标为 Active；每个可选字段为 `AUTHENTICATED`。           |
| 读取其他用户处理后头像 | 同上，并且目标用户的头像可见性为 `AUTHENTICATED`。                               |
| 修改昵称、简介或头像   | 只能修改本人；目标身份只能来自服务端验证通过的 Session。                         |
| 修改字段可见性         | 只能修改本人；必须提供允许的 Origin 和匹配 Session 的 CSRF Token。               |
| 修改其他用户           | 设计上禁止；不存在这种 HTTP Route，且本人更新 Body 会拒绝调用方提供的 `userId`。 |

共享 Response 在结构上使用 Allowlist，只包含 `id`、`nickname`、`bio`、`avatarUrl`、`email` 和 `phone`。目标用户未共享的可选字段返回 `null`，Response 不会透露隐藏联系方式是否存在。它不包含时间戳、登录身份、非 Primary 或已 Retired 联系方式、账号状态、昵称配额/历史、可见性设置、Object Key 或 Audit Record。Inactive 与不存在的目标用户都返回 `404`，避免额外泄露账号状态。

缺少 Actor Session，或者 Session 已过期、已撤销、所属账号不是 Active 状态时，返回 `401`。所有写操作还必须同时提供允许的 `Origin` 和绑定到同一个 Session 的 CSRF Token；缺少或不匹配时返回 `403`。共享读取在 Controller 和 Service 中都携带可信 Actor ID。未来若增加匿名、组织范围、客服或管理员访问，必须使用独立 Route 并执行明确的 Policy Check，绝不能扩大这些本人更新 Handler 的权限。

## HTTP 契约

所有 Endpoint 都要求有效的不透明浏览器 Session。写操作还要求允许的 `Origin` 和 Session CSRF Token。

| 方法与路由                         | 请求                                    | 结果                                                     |
| ---------------------------------- | --------------------------------------- | -------------------------------------------------------- |
| `GET /api/profile`                 | Session Cookie                          | 返回本人字段、可见性设置、时间戳和昵称修改配额。         |
| `PATCH /api/profile`               | CSRF；`nickname?`、`bio?`               | 规范化并原子更新提供的字段；空简介文本会清除简介。       |
| `PATCH /api/profile/visibility`    | CSRF；部分字段可见性 Object             | 分别修改本人简介、头像、邮箱或手机号的可见性。           |
| `PUT /api/profile/avatar`          | CSRF；Multipart 字段 `file`，最大 5 MiB | 校验并重新编码一张图片，替换私有头像并返回最新 Profile。 |
| `GET /api/profile/avatar`          | Session Cookie；可选 `If-None-Match`    | 代理私有 WebP 头像，带 ETag 和私有缓存策略。             |
| `DELETE /api/profile/avatar`       | CSRF                                    | 删除头像引用，并尽力删除旧 Object。                      |
| `GET /api/profiles/:userId`        | Session Cookie                          | 返回 Active 目标用户经过 Allowlist 的共享字段。          |
| `GET /api/profiles/:userId/avatar` | Session Cookie；可选 `If-None-Match`    | 代理 Active 目标用户处理后的头像。                       |

Profile Response 永远不暴露 S3/MinIO Bucket 或 Object Key。`avatarUrl` 包含头像更新时间，因此前端可以正常使用图片缓存，同时避免替换后仍显示旧头像。

## 字段可见性与联系方式隐私

每个可选共享字段使用 `PRIVATE` 或 `AUTHENTICATED`。四项设置默认都是 `PRIVATE`，包括功能上线前已存在的账号。部分更新只改变提交的字段，在 PostgreSQL User Row Lock 下串行执行，并记录 `profile.visibility.changed`；提交未变化的设置属于 No-op。

`AUTHENTICATED` 表示可通过共享 Profile Route 被 Active 登录用户查看，并不表示允许互联网匿名访问。只有已验证且未 Retired 的联系方式才可能展示；存在多个同类型联系方式时优先 Primary。可见性设置不会改变登录、账号恢复或通知投递使用的邮箱/手机号。联系方式被删除或 Retire 后会自动从共享 Response 消失。公开联系方式会增加钓鱼、垃圾信息、自动抓取和骚扰风险，因此前端必须解释影响，并要求用户对每个字段明确 Opt-in。

## 昵称策略

- 使用 Unicode NFKC 规范化输入，去除首尾空白，并把内部连续空白合并成一个空格。
- 接受 1–16 个 Unicode Code Point，拒绝控制字符；昵称不要求全局唯一。
- 任意连续 30 天内最多成功修改三次。注册或 Provider 首次赋予的昵称不计为修改。
- 提交与已保存规范化昵称相同的值属于 No-op，不消耗配额。简介与头像修改永远不消耗昵称配额。
- 在统计并插入修改记录之前锁定 PostgreSQL User Row，从而串行化昵称修改。四个并发请求不能全部通过过期计数。
- 配额耗尽时返回 `429`、Problem Code `NICKNAME_CHANGE_LIMIT`、`retryAt` 和 HTTP `Retry-After` Header。`GET /api/profile` 也返回 `limit`、`used`、`remaining` 和 `nextChangeAllowedAt`，使 UI 能在提交前解释限制。

滚动窗口精确定义为 30 × 24 小时，而不是自然月。这样可避免月份长度和时区造成不确定性。未来若修改产品策略，必须同时更新 API Contract 和测试。

## 简介策略

简介使用 NFC 规范化，换行统一为 `\n`，去除首尾空白，并限制为 500 个 Unicode Code Point。空文本和显式 `null` 都会清除简介。该值是纯文本：客户端必须按文本渲染，不能当作未经清理的 HTML。互联网匿名展示、链接、Mention 解析、滥用举报、内容审核和发现功能需要另外设计。

## 头像安全与生命周期

API 最多在内存中接收 5 MiB，然后由 Sharp 解码实际字节，而不是信任文件名或 MIME Header。只接受单页 JPEG、PNG 和 WebP，解码上限为 2500 万像素。服务端处理方向、裁剪/缩放至 512 × 512、移除源 Metadata，并把不超过 1 MiB 的 WebP 结果写入私有 S3 兼容 Bucket。

Object 使用随机生成的 Key。存储成功后，PostgreSQL Transaction 锁定 User、切换引用并写入 Audit Event。数据库失败时尽力删除新 Object；替换成功后尽力删除旧 Object。并发替换在数据库引用更新阶段被串行化，因此后完成的更新会清理它替换掉的 Object。生产环境仍需要 Object Inventory Reconciliation Job，以清理由少量存储/网络故障造成的孤儿 Object。

本地开发和测试可以自动创建缺失 Bucket。Staging 与 Production 会 Fail Closed，并要求预先创建私有 Bucket、使用 HTTPS Object Storage Endpoint 和非本地凭据，同时配置加密/访问策略、生命周期规则、适当的备份和监控。本人头像 Endpoint 始终允许本人读取；跨用户 Endpoint 只有在头像可见性为 `AUTHENTICATED` 时才返回图片。未来若支持匿名或大规模分发，需要独立隐私决策，并通常使用独立 Media Origin 或带签名的 CDN URL。

## 审计与可观测性

模块记录 `profile.nickname.changed`、`profile.bio.changed`、`profile.avatar.changed`、`profile.avatar.removed` 和 `profile.visibility.changed`。Audit Record 有意不复制简介、昵称、联系方式、可见性值、Object Key、图片字节、Cookie 或 CSRF Token。应监控 429 比例、无效图片拒绝、处理延迟、Object Storage 故障、Object 删除失败和 Bucket 容量，但不能记录用户内容。
