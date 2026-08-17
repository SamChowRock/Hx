# 19. 常见错误与反模式

> [返回教程首页](README.md)

## 19.1 在 Controller 里堆业务逻辑

后果：无法复用、难测试、容易绕过授权。把业务用例放进 Service。

## 19.2 只验证登录，不验证资源归属

“已登录”不等于“能读这个 Project”。必须验证 Membership、动作和资源租户范围。

## 19.3 信任客户端传来的 `userId` 或 `organizationId`

`userId` 来自 Session；`organizationId` 必须经 Membership 校验。客户端字段不能成为信任根。

## 19.4 用 TypeScript 类型代替运行时校验

网络输入是 `unknown`。必须 Zod Parse，Worker Payload 和环境变量也一样。

## 19.5 在数据库事务中调第三方 API

网络慢会延长锁，失败语义也不清楚。事务内写 Outbox，事务外由 Worker 调 Provider。

## 19.6 把 Redis 当真相来源

Cache 可以丢。权限和关键状态最终以 PostgreSQL 为准。Queue Redis 也不能成为不可恢复副作用的唯一记录。

## 19.7 宣称 Exactly Once

网络和进程崩溃下通常只能做到 At-least-once + 幂等。重复执行是正常场景，必须设计。

## 19.8 把原始异常返回给客户端

Prisma 错误和 Stack Trace 会泄露实现细节。统一映射为稳定 Problem Details，并在服务端安全记录。

## 19.9 生成 Migration 后不看 SQL

Schema 声明正确不代表生成操作适合大表或滚动发布。Migration 是生产代码。

## 19.10 看到 Redis 就立即上缓存

先测量慢查询。优先修索引、查询范围和 N+1；缓存需要 TTL、失效、租户命名空间、防击穿和降级设计。

## 19.11 为了“高级”过早拆微服务

拆分会增加服务认证、数据一致性、追踪、部署和故障处理成本。只有独立扩容、可靠性、安全边界或团队所有权压力得到证明时才拆。

## 19.12 Mass Assignment：把整个 Body 传给 ORM

危险写法：

```ts
await database.membership.create({ data: request.body });
```

即使前端表单没有 Role 输入，攻击者也能提交：

```json
{ "userId": "attacker", "organizationId": "victim-org", "role": "OWNER" }
```

正确做法是 Zod 只允许用例字段，然后服务端推导 Tenant、Actor、Role 上限和时间：

```ts
const input = addMemberSchema.parse(body);
await service.addMember(actor, organizationId, input.email, input.role);
```

Response 也使用 Allowlist Mapper，不直接返回带未来敏感列的 ORM Entity。

## 19.13 Injection：ORM 不是免死金牌

Prisma 的结构化 Query 通常参数化，能降低 SQL Injection；但这些地方仍危险：

- `$queryRawUnsafe` 拼接用户字符串；
- 动态 `ORDER BY`、字段名和 Filter 未做 Allowlist；
- 把用户 HTML 发送到邮件/页面造成 XSS；
- Shell Command 拼接文件名；
- LDAP/Template/Regex 等其他注入；
- 日志换行/控制字符造成 Log Injection。

原则：值使用参数化，结构使用明确 Allowlist，不把不可信字符串拼进另一种语言。

## 19.14 SSRF：后端替用户访问 URL

如果未来实现“导入 URL”或 Webhook 测试，攻击者可能让服务器访问：

```text
http://127.0.0.1:...
http://169.254.169.254/metadata
内部数据库/管理面板
经过 Redirect 指向的内网地址
```

防护包括：

- 尽可能不用任意 URL，改为受支持 Provider；
- Scheme Allowlist，只允许 HTTPS；
- DNS 解析后拒绝 loopback、private、link-local 和保留地址；
- 每次 Redirect 重新校验；
- 出站网络策略阻断内部元数据/管理网；
- 限制端口、响应大小、Content Type 和 Timeout；
- 不把响应原样当可信 HTML；
- 防 DNS Rebinding。

只用 `new URL()` 验证格式远远不够。

## 19.15 文件上传不是“收到 Buffer 后保存”

不可信文件可能包含：

- 超大体积耗尽内存/磁盘；
- 声明 image/png，实际是 HTML/可执行内容；
- 解压炸弹；
- 超大像素图片；
- 恶意 PDF/Office 宏；
- 路径穿越文件名；
- 同源 SVG/HTML 脚本；
- 病毒或隐私数据。

所以蓝图要求：

```text
PendingUpload → Quarantined → Scanning → Available
                              ↘ Rejected
```

文件先进入私有 Object Storage 隔离区，Worker 验证真实大小、Magic Number、Checksum、格式并扫描，只有 `Available` 才能签发短期下载 URL。Object Key 用服务端生成 ID，不用原始文件名。

## 19.16 Rate Limit 不是完整防滥用系统

当前全局 60 秒 30 次只是基础保护。真实策略要按风险区分：

- 登录：IP + Identifier + 设备信号；
- 注册/重置：防账号枚举与邮件轰炸；
- 手机 OTP：发送冷却、小时上限、错误次数；
- 大导出：Tenant 配额 + 并发上限；
- Webhook：Provider 身份 + Event ID；
- 普通读取：用户/Tenant/Endpoint 成本；
- Worker：按队列设置并发和 Backpressure。

只按 IP 限流会误伤 NAT 后的公司用户，也容易被分布式 IP 绕过。错误响应、Captcha、风险评分、配额和运营监控需要组合设计。

## 19.17 Secret、PII 和日志

先给数据分类：

- Public：公开资料；
- Internal：内部业务信息；
- Personal：邮箱、手机号、IP、User-Agent；
- Sensitive：密码 Hash、Session/Reset Token、Provider Credential、支付/身份数据。

每类定义：访问角色、加密、日志脱敏、保留期、删除、导出和审计。常见原则：

- Secret 放 Secret Manager，不提交 `.env`；
- 密码永远不可恢复，只存专用 Hash；
- Session/一次性 Token 存 Hash；
- 日志默认不记录 Body、Cookie、Authorization；
- Provider 错误可能带敏感数据，不原样持久化；
- 数据库备份同样是敏感资产；
- “为了以后分析”不是无限保留 PII 的理由。

## 19.18 Webhook 的双向安全

接收 Webhook：

1. 对 Raw Body 验签，不能先 JSON Re-serialize；
2. 校验时间戳和重放窗口；
3. 先持久化 Provider Event ID，用 Unique 防重复；
4. 快速返回，再异步处理；
5. Payload 经过版本化 Schema；
6. 不因顺序假设破坏状态。

发送 Webhook：

1. 每订阅使用可轮换 Secret；
2. 签名覆盖时间戳 + Raw Body；
3. Logical Event ID 在重试/人工重放中不变；
4. Timeout、有限重试和 Dead 状态；
5. 防止目标 URL SSRF；
6. 记录 Delivery Attempt，但脱敏 Secret；
7. 为消费者提供幂等与签名文档。

Webhook 返回 200 也不一定代表对方业务完成，只代表对方声称接受；双方都应按至少一次和幂等设计。

## 19.19 把微信登录伪装成 OIDC

微信开放平台网站扫码流程虽然也有 Authorization Code，但它不是 OIDC：

- 没有标准 Discovery Document；
- 没有由应用按 OIDC 规则验证的 ID Token；
- 没有 OIDC Issuer、Audience、Nonce Claim 语义；
- 身份来自换取 Access Token 后再次请求 Profile；
- Provider Error、Identifier Scope 和返回格式具有微信特性。

如果强行复用 OIDC Adapter，代码表面更“通用”，实际会跳过本应存在的验证。正确抽象不是把不同协议压成一个类，而是让 Controller 共享 Start/Callback 用例，让 `OidcService` 与 `WeChatOAuthService` 分别维护自己的协议不变量。

同样危险的是“有 UnionID 就用 UnionID，没有就用 OpenID”。一个用户第一次登录没有 UnionID，之后应用绑定开放平台账号开始返回 UnionID，身份主键就会改变，可能创建重复账号或错误绑定。当前项目始终使用网站 AppID 作用域的 Issuer 加 `openid:<OpenID>`；UnionID 只做一致性检查，不做机会式主键切换。

## 19.20 信任 OAuth Profile 和 Provider Token

OAuth Profile 是外部网络输入，不能因为来自知名 Provider 就跳过边界控制：

- Token Response 与 Profile 都必须经过运行时 Schema 校验；
- Token 与 Profile 的 OpenID 必须一致；
- 两边都返回 UnionID 时必须一致；
- Nickname 要限制长度、移除控制字符，并且只能作为显示默认值；
- 微信不提供本项目已验证的邮箱/手机号，不能据此自动合并本地账号；
- Access Token/Refresh Token 若只为本次登录取 Profile，就不应持久化；
- 请求目标必须是固定 HTTPS Host，拒绝 Redirect，设置 Timeout 与响应大小上限；
- Provider Error、URL、Token 和 AppSecret 不能原样写日志。

如果未来需要持续调用微信 API，应建立独立、加密的 Connection/Grant 模型，明确 Scope、过期、刷新、撤销和审计。不要顺手把长期 Token 塞进 `ExternalIdentity`，因为“登录身份”和“持续 API 授权”是不同生命周期、不同泄漏影响的资产。

## 19.21 把 Profile 当作公开的 `User` JSON

“登录用户都能看见全部资料”会把真实邮箱、手机号、对象存储 Key、账号状态和未来敏感列一起变成泄漏面。正确做法是分开本人视图与共享视图：共享 Response 使用结构 Allowlist，未开放字段返回 `null`，并把不存在/不活跃/无权读取头像统一成合适的拒绝语义。不要让前端传入的 `userId` 决定写入目标；它只能来自通过 Session 验证的 Actor。

## 19.22 信任上传文件，或把 Bucket URL 直接给浏览器

文件名和 MIME Header 都不可信。当前头像接受有限的字节数、格式和像素上限，重新编码成统一 WebP，再写进私有 Bucket；API 代理字节流，不暴露 Object Key。生产还需要私有 Bucket、HTTPS、非本地凭据、生命周期规则和孤儿对象对账。把上传原文件直接公开到静态域名，会同时引入脚本、内容嗅探、隐私、缓存失效和访问控制问题。

## 19.23 把 SSE 当成可靠通知系统

内存广播会在 API 重启、多副本和浏览器断线时丢失事件；SSE 自动重连也无法保证无限回放。当前通知模块以 PostgreSQL 收件箱为事实源，Outbox 负责业务原子性，SSE 只降低 UI 延迟，并用 `Last-Event-ID` 有界回放与周期性数据库对账。客户端收到 `resync-required` 时必须拉取列表/未读数；不要用“红点事件没来”推断没有通知。

---
