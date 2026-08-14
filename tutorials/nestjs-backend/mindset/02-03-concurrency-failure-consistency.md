# 并发、网络失败、一致性与不变量

> [返回教程首页](../README.md) · [本模块目录](README.md)

## 2.8 后端永远处在并发中

即使 Node.js 主要在一个 Event Loop 上执行 JavaScript，也不代表业务请求串行：

- 一个 `await` 期间会处理其他请求；
- 可以运行多个 API 实例；
- API 和 Worker 同时访问数据库；
- 用户可以开多个 Tab/设备；
- 代理和客户端会重试；
- 定时任务与人工操作会重叠。

典型错误：组织只剩一个 Project 配额，两个请求同时创建。

```text
Request A: SELECT remaining = 1
Request B: SELECT remaining = 1
Request A: INSERT Project, remaining = 0
Request B: INSERT Project, remaining = 0
结果：创建了 2 个，违反配额
```

“先查一下再写”不能自动解决并发。常见工具：

| 问题                 | 常用保护                           |
| -------------------- | ---------------------------------- |
| 重复邮箱/成员        | Unique Constraint                  |
| 资源必须属于组织     | Foreign Key + Tenant-scoped Query  |
| 数量不能小于 0       | 条件 Update / Check Constraint     |
| 用户编辑不能互相覆盖 | Version/ETag 乐观锁                |
| 多表同时成功         | Transaction                        |
| 必须串行修改同一行   | Row Lock/Serializable，配合重试    |
| 重复 HTTP 请求       | Idempotency Key + Unique Scope     |
| 重复 Job             | Business Key / Inbox Deduplication |

数据库约束不是“防止开发者粗心”的最后补丁，而是所有进程共同遵守的并发裁判。

## 2.9 网络失败不等于操作失败

这是前端转后端最需要建立的分布式系统直觉。

```text
Browser ──POST──> API ──COMMIT──> PostgreSQL
                    X
              Response 在网络中丢失
```

前端看到 `TypeError: Failed to fetch`，但 Project 可能已经创建。若直接重试，会创建两个 Project。

所以后端需要区分：

- **确定失败**：输入校验在写库前返回 400；
- **确定成功**：客户端收到成功响应；
- **结果未知**：超时、连接重置，服务端可能提交也可能没有；
- **部分失败**：数据库成功，邮件 Provider 失败；
- **暂时失败**：429、5xx、网络抖动；
- **永久失败**：非法邮箱、未知 Event Version、业务规则不允许。

可靠设计的组合是：

```text
明确 Timeout
+ 只有安全操作才 Retry
+ 写操作使用 Idempotency Key
+ 数据库用 Unique/Transaction
+ 外部副作用走 Outbox
+ Worker 按 At-least-once 设计幂等
+ 失败可观察、可告警、可重放
```

不要写无上限 Retry。下游故障时，无限重试会放大流量，把局部故障变成系统雪崩。

## 2.10 一致性不是越强越好，而是按业务不变量选择

本项目里有两类结果：

### 必须立即一致

创建 Task 时：

- Task 必须属于真实 Project；
- Actor 必须有权限；
- Task 与审计事件要一起提交；
- 成功响应后任何读取都应看到 Task。

这些放在同一 PostgreSQL Transaction。

### 可以最终一致

注册时：

- RegistrationIntent 和 Outbox 必须立即提交；
- 邮件可以数秒后到达；
- Provider 暂时失败可重试；
- 用户不应为了 SMTP 延迟一直等待 HTTP 请求。

这就是 Outbox + Worker。

如果把所有动作都做成同步调用，请求慢且容易被第三方拖垮；如果把所有动作都异步化，用户可能创建完却马上读不到，业务规则也更难保证。关键问题是：**响应返回前，哪些事实必须已经成立？哪些副作用允许稍后完成？**

## 2.11 同步还是异步的判断表

| 操作              | 推荐         | 原因                                 |
| ----------------- | ------------ | ------------------------------------ |
| 验证输入与权限    | 同步         | 不通过就不能接受请求                 |
| 创建 Project/Task | 同步事务     | 客户端需要明确创建结果               |
| 写审计事件        | 通常同一事务 | 重要动作不应存在却没有审计           |
| 发验证邮件/短信   | 异步 Outbox  | 慢、可重试、第三方不可靠             |
| 生成大型导出      | 异步 Job     | 耗时和资源不可预测                   |
| 小型权限查询      | 同步         | 响应无法脱离结果完成                 |
| Webhook 投递      | 异步         | 下游可能慢或失败                     |
| 支付确认          | 依产品语义   | 可能同步确认，也可能状态机 + Webhook |
| 上传后病毒扫描    | 异步状态机   | CPU/时间长，扫描前文件不能 Available |

异步不是“更高级”，它引入状态、重试、幂等、积压、Dead Letter、观察和用户进度展示。只有收益超过这些成本时才使用。

## 2.12 先定义不变量，再选择代码结构

不变量是系统任何时刻都必须成立的事实。例如：

```text
一个 User 在一个 Organization 最多一条 Membership。
每个 Project 只属于一个 Organization。
Viewer 不能创建 Project。
Session Secret 不以明文存库。
Registration Token 只能消费一次。
密码修改后旧 Session 全部失效。
Task 和 task.created AuditEvent 要么都写入，要么都不写。
```

然后决定由哪层保护：

| 不变量               | 保护层                         |
| -------------------- | ------------------------------ |
| Body 长度/Enum       | Zod                            |
| Actor 是否有效       | Identity/Authorization Service |
| 角色允许动作         | Policy                         |
| Resource 属于 Tenant | Scoped Query + Foreign Key     |
| 不重复               | Unique Constraint              |
| 多写原子性           | Transaction                    |
| 不被旧版本覆盖       | Version/Conditional Update     |
| 外部副作用不丢       | Outbox                         |
| 重复投递无害         | Idempotent Consumer            |

Controller、Service、Database 和 Worker 的边界不是为了目录整齐，而是让每种不变量放在最可靠且可复用的位置。
