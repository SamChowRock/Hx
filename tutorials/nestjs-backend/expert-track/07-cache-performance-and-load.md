# 缓存、性能、容量与负载测试

> [返回专家训练目录](README.md)

## 1. 性能工作从基线开始

不要先加 Redis。先定义：

```text
Endpoint / 数据规模 / 并发
p50 / p95 / p99
错误率
CPU / Memory
DB Query Time / Connections
吞吐 RPS
目标 SLO
```

## 2. 建立负载模型

示例：

```text
70% Project List
20% Task List
5% Create Task
3% Login
2% Export request
Tenant: 多数 20 Project，少数 100k
```

平均用户模型会掩盖大 Tenant 和热点。

## 3. Mandatory Lab A：无缓存基线

使用 k6、autocannon 或等价工具，对本地/隔离环境运行阶梯负载：

```text
1 → 10 → 50 → 100 virtual users
每阶段 2～5 分钟
```

记录延迟、RPS、错误、API CPU、数据库连接和慢查询。找到第一个饱和资源。

## 4. 优化顺序

1. 修无界输入；
2. 消除 N+1；
3. 正确 Select；
4. 增加/调整 Index；
5. 缩短事务；
6. 预算连接池；
7. 避免同步重型工作；
8. 测量仍不达标时考虑 Cache；
9. 最后评估扩容/架构变化。

## 5. Mandatory Lab B：Cache-aside

选择低风险、读多写少的 Project Summary。要求：

- Key 含 Environment/Tenant/Resource/Schema Version；
- Value 有 Zod Schema；
- TTL + Jitter；
- Cache Miss 回源；
- Redis Timeout 很短；
- Redis 故障回源；
- DB Commit 后失效；
- 不缓存未授权结果；
- Metrics 区分 hit/miss/error。

## 6. Cache Correctness Tests

- 命中返回相同 Contract；
- 更新后旧 Cache 不再返回；
- Redis 完全不可用仍正确；
- Tenant A Key 不可能命中 Tenant B；
- Schema Version 变化不反序列化旧值；
- 负缓存过期后新资源可见；
- 并发 Miss 不形成无限回源。

## 7. Stampede Lab

让热门 Key 同时过期，并发 100 个请求。记录数据库 Query Count。实现 Singleflight/Lock 或 Soft TTL Early Refresh，再比较。

锁本身必须有：

- TTL；
- Owner Token；
- 只允许 Owner 释放；
- 等待上限；
- Redis 故障降级。

## 8. Capacity Math

粗略预算：

```text
RPS = active_users × actions_per_second
Concurrent requests ≈ RPS × average_latency_seconds
DB query rate = RPS × queries_per_request
Cache memory = key_count × average_entry_size × overhead
Worker concurrency <= provider quota and DB capacity
```

这些不是精确预测，而是暴露数量级错误。

## 9. Tail Latency

平均 50ms、p99 3s 对用户仍然很差。调查：

- GC/CPU Pause；
- Pool 等待；
- Lock 竞争；
- Cold Cache；
- Provider 长尾；
- 大 Tenant；
- Retry；
- 大 Response/序列化。

## 10. Timeout Budget

假设 API p95 700ms：

```text
Proxy 750ms
API 总预算 650ms
DB 300ms
同步 Provider 200ms
应用计算/排队 150ms
```

不能给每个依赖 5 秒。串行下游的预算相加，并行则受最慢者影响。

## 11. Overload Lab

逐步加压直到错误。观察系统是：

- 429/503 可预测拒绝；
- Pool Queue 无限增长；
- Memory 增长；
- Timeout Storm；
- 健康检查一起失败。

增加 Body/分页上限、Rate Limit、Concurrency Limit 和 Backpressure，再复测。

## 12. Cache ADR

必须写：

- 为什么数据库优化不足；
- 缓存对象和 Key；
- Source of Truth；
- Freshness Requirement；
- Invalidation；
- Failure Mode；
- Tenant Isolation；
- Capacity/TTL；
- Metrics；
- 移除条件。

## 13. 交付物

- 可重复 Load Script；
- 无缓存 Baseline；
- Query/Index 优化报告；
- Cache Correctness Test；
- Stampede 前后对比；
- Capacity/Timeout Budget；
- Cache ADR。
