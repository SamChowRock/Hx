# 可观测性、SLO 与事故响应

> [返回专家训练目录](README.md)

## 1. 可观测性不是“多打日志”

你要能从外部信号推断内部状态：

- Logs：离散事件和上下文；
- Metrics：趋势、比例、分布和告警；
- Traces：一次请求跨组件的因果路径；
- Audit：谁对什么做了敏感动作；
- Profiles：CPU/Memory 热点。

## 2. 定义 SLI/SLO

Project API 示例：

```text
Availability SLI = 非 5xx 合格请求 / 总合格请求
Latency SLI = 响应时间分布
SLO = 月 99.9% 成功，读 p95 < 300ms，写 p95 < 700ms
```

明确排除项：客户端 4xx 是否算失败？维护窗口？健康检查？

## 3. Error Budget

99.9% 月可用约 43 分钟错误预算。预算消耗过快时应优先可靠性而不是继续高风险发布。

## 4. Golden Signals

- Latency；
- Traffic；
- Errors；
- Saturation。

再加业务信号：注册完成率、Outbox Oldest Age、Dead Count、跨租户拒绝异常增加。

## 5. Mandatory Lab A：结构化请求链路

为 Project Create 确保这些字段可关联：

```text
requestId
route template（不是含 PII 的原始 URL）
method/status/duration
actorUserId（按隐私策略）
organizationId
projectId
errorCode
```

不要记录 Cookie、Token、密码、完整 Query/Body。

## 6. Mandatory Lab B：Outbox Metrics

实现或设计：

- Pending by Type；
- Oldest Pending Age；
- Delivery Duration Histogram；
- Attempts Distribution；
- Dead Count；
- Stale Lock Recovery；
- Provider Error Code（脱敏分类）。

告警优先使用“用户影响/积压年龄”，不是只看进程是否活着。

## 7. Trace 设计

API 事务写 Outbox 后，HTTP Trace 已结束。Event Payload/Row 保存安全的 Correlation Context，Worker 建立新 Span 并 Link 到 Producer Context，而不是把整个 Header/PII 复制过去。

## 8. Liveness/Readiness

- Liveness 只证明进程应否重启；
- Readiness 证明能否接流量；
- 外部邮件故障通常不应杀 API；
- Shutdown 时先 Readiness Fail，再 Drain。

错误健康检查会造成重启风暴。

## 9. Mandatory Incident Drill：邮件全部延迟

场景：SMTP Provider 30 分钟不可用。

你需要：

1. 告警被哪个 SLI 触发；
2. 判断 API 注册是否仍可用；
3. 检查 Outbox Oldest Age/Attempts；
4. 防 Retry Storm；
5. 与用户/支持沟通影响；
6. Provider 恢复后控制 Drain 速率；
7. 检查重复邮件；
8. 写事后复盘。

## 10. Incident Command

明确角色：Incident Commander、Operations、Communications、Scribe。小团队可一人多角，但职责仍要明确。

时间线只记录事实：告警、观察、操作、结果，不把猜测当结论。

## 11. Postmortem 模板

```markdown
Impact
Detection
Timeline
Root cause
Contributing factors
What worked / failed
Where we got lucky
Corrective actions (owner + due date)
```

避免“某人操作失误”作为终点；继续问为什么系统允许单点错误造成影响。

## 12. Runbook 质量

Runbook 应让非作者也能：

- 确认症状；
- 执行只读诊断；
- 选择安全缓解；
- 知道哪些操作需要审批；
- 验证恢复；
- 回退缓解动作。

## 13. Dashboard 设计

从用户旅程组织，而不是按技术组件堆图：

```text
注册请求 → Intent/Outbox → 邮件投递 → 验证 → 完成账号
```

同屏看到成功率、延迟、积压和 Provider 状态。

## 14. 交付物

- SLI/SLO/Error Budget 文档；
- Logging Schema 与脱敏测试；
- Outbox Metrics 设计/实现；
- Trace Context 设计；
- Email Incident Drill；
- Postmortem；
- 两份可执行 Runbook。
