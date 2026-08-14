# 16. 日志、健康检查与排错

> [返回教程首页](README.md)

## 16.1 结构化日志

API 使用 `nestjs-pino`。记录日志时用结构化字段：

```ts
this.logger.log({ organizationId, projectId, taskId }, 'Task created');
```

而不是：

```ts
console.log(`Task ${taskId} created in ${organizationId}`);
```

结构化字段可被日志平台索引、聚合和告警。

永远不要记录：

- 密码；
- Session Cookie/Secret；
- CSRF Token；
- 注册、重置 Token；
- OIDC Code/Verifier/Nonce；
- 微信 AppSecret、Authorization Code、Access/Refresh Token、完整 Provider URL/Profile；
- Twilio/SMTP 凭据；
- 不必要的完整邮箱、手机号和请求体。

## 16.2 Liveness 与 Readiness

- `/api/health/live`：进程是否活着，不访问数据库；
- `/api/health/ready`：是否能连接数据库，不能则返回 503。

容器编排应：

- Liveness 失败时重启进程；
- Readiness 失败时停止分发流量；
- 不要因为短暂外部邮件 Provider 故障就杀掉 API。

## 16.3 常用排错顺序

当接口失败时，按边界从外到内检查：

1. URL 是否带 `/api`；
2. API 是否监听 3000；
3. CORS Origin 是否在 `API_CORS_ORIGINS`；
4. 浏览器 `fetch` 是否用了 `credentials: 'include'`；
5. Session Cookie 名称是否符合环境；
6. 写请求是否有正确 Origin 和 CSRF；
7. Session 是否绝对/空闲过期或被撤销；
8. Membership 是否属于目标 Organization；
9. Service 查询是否带租户范围；
10. Zod 返回了哪个 path；
11. PostgreSQL 是否 ready、Migration 是否齐全；
12. Worker 是否启动、Outbox 是 PENDING/PROCESSING/DEAD；
13. Mailpit/Provider 是否可用。

## 16.4 常见故障命令

```bash
docker compose ps
docker compose logs --tail=200 api worker postgres
curl -i http://localhost:3000/api/health/ready
pnpm typecheck
pnpm test
pnpm exec prisma migrate status
```

端口 3000 冲突时：

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

## 16.5 Outbox 排错

根据状态判断：

| 状态       | 含义               | 排查                                          |
| ---------- | ------------------ | --------------------------------------------- |
| PENDING    | 等待可用时间或重试 | `availableAt`、Worker 是否运行                |
| PROCESSING | 已被领取           | `lockedAt` 是否陈旧、Worker 是否崩溃          |
| DELIVERED  | 已成功             | `deliveredAt`、Payload 应已脱敏               |
| DEAD       | 达到最大次数       | Provider 配置、网络、Payload Schema、重放流程 |

当前项目还没有管理 UI 和重放工具，不要随意在生产数据库手改状态；应先设计经过审计的运维命令。

## 16.6 三个具体排错案例

### 案例 A：浏览器登录成功，但后续 `/auth/session` 返回 401

检查：

1. Network 面板登录响应是否有 `Set-Cookie`；
2. fetch 是否 `credentials: 'include'`；
3. API 与 Web Origin 是否和 Cookie/SameSite 配置匹配；
4. 浏览器是否存下 `dev-session` 或 `__Host-session`；
5. 数据库 Session 的 Hash、过期和 revokedAt；
6. 用户状态是否 ACTIVE；
7. 反向代理是否正确传递 Cookie/HTTPS 信息。

不要把 HttpOnly Cookie “改成前端可读”来调试，那会破坏安全边界。

### 案例 B：创建 Project 返回 403

依次区分：

- Detail 是 Origin Header Required/Not Allowed：前端 Origin 配置；
- Detail 是 Invalid CSRF Token：先重新读取 `/auth/session`，不要混用另一个 Session Token；
- Detail 是 Organization Permission：Membership/Role 问题；
- 如果是 401：Session 本身无效，还没进入角色判断。

相同状态码可能来自不同边界，因此要看安全的 Problem Detail 与 Request ID。

### 案例 C：注册接口 202，但邮件没到

按数据流逐段检查：

1. `registration_intents` 是否存在；
2. `outbox_events` 是否存在；
3. Status 是 PENDING、PROCESSING、DEAD 还是 DELIVERED；
4. Worker 是否有启动日志；
5. `SMTP_URL` 在 Host 模式是否指向 `localhost:1025`，容器模式是否指向 `mailpit:1025`；
6. Mailpit 服务和 UI 是否正常；
7. Payload 是否通过 Worker Zod Schema；
8. 是否触发最大重试进入 DEAD。

这叫按链路二分问题，比“重启全部服务试试”更可重复。

## 16.7 数据库查询慢时怎么查

先记录具体 Endpoint、租户数据量和 p95，而不是凭感觉加 Redis。检查：

1. Prisma 查询是否无界；
2. 是否发生 N+1；
3. `where/orderBy` 是否有匹配索引；
4. 是否 Select 了大字段；
5. 是否在长事务里等待网络；
6. 数据库连接池是否耗尽；
7. 用 `EXPLAIN (ANALYZE, BUFFERS)` 查看真实计划；
8. 加索引后对写入成本和磁盘进行复测。

不要在生产高峰对昂贵查询随意使用 `EXPLAIN ANALYZE`，它会真实执行语句。先在安全副本重现。

---
