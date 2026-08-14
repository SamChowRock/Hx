# 索引、统计信息与查询计划

> [返回本模块目录](README.md)

## 1. Index 是额外的数据结构

Index 保存 Key → Row Location，换取更少扫描。它不是免费：

- 占磁盘/Cache；
- Insert/Update/Delete 维护；
- 产生 WAL；
- 增加 Vacuum 工作；
- Build 可能影响生产。

## 2. B-tree

默认 B-tree 适合：

- 等值；
- 范围；
- 前缀排序；
- `ORDER BY`；
- Min/Max。

当前：

```prisma
@@index([organizationId, createdAt])
```

匹配“某 Tenant 按时间列 Project”。

## 3. 组合索引顺序

`(organization_id, created_at, id)` 通常支持：

```text
organization_id = ?
organization_id = ? AND created_at < ?
organization_id = ? ORDER BY created_at, id
```

通常不能高效支持只有 `created_at`、没有左侧 organization 的任意查询。

先放等值/租户 Scope，再考虑范围与排序，但最终以真实 Query Plan 为准。

## 4. 其他 Index

- Hash：等值，较少作为默认；
- GIN：JSONB、Array、全文等倒排；
- GiST：范围、地理、相似等；
- BRIN：超大且物理顺序相关的表，体积小；
- Expression：`lower(email)`；
- Partial：只索引 `status='PENDING'`；
- INCLUDE：Covering Column。

## 5. Partial Index

Outbox 查询主要看 Pending/Processing：

```sql
CREATE INDEX outbox_claimable_idx
ON outbox_events (available_at, created_at)
WHERE status IN ('PENDING', 'PROCESSING');
```

比索引所有 Delivered Row 小，但 Query 条件必须让 Planner 能证明符合 Predicate。

## 6. Unique Index

Unique Constraint 通常由 Unique Index 支撑。它同时是业务正确性与访问路径，不要只当性能工具。

Partial Unique 可表达“同组织/邮箱只有一个 Pending Invitation”。

## 7. Query Planner

Planner 根据：

- Table/Index Statistics；
- Row Count/Distribution；
- Cost 参数；
- Join 顺序/算法；
- 可用内存；
- Query 结构；
- 参数值估计。

选择 Seq Scan 不一定错误：返回大部分表时顺序读可能更快。

## 8. EXPLAIN

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT ...;
```

- `EXPLAIN` 只计划；
- `ANALYZE` 真正执行，写语句会真的写；
- `BUFFERS` 显示 Hit/Read/Dirtied；
- 生产对昂贵写语句谨慎。

## 9. 常见 Node

- Seq Scan；
- Index Scan；
- Index Only Scan；
- Bitmap Index/Heap Scan；
- Nested Loop；
- Hash Join；
- Merge Join；
- Sort/Incremental Sort；
- Aggregate/HashAggregate。

重点比较 Estimated 与 Actual Rows。差距大可能是 Statistics、相关性或表达式问题。

## 10. Statistics

ANALYZE 收集分布。Autovacuum 也会自动 Analyze。大量导入后 Statistics 未更新，Planner 可能错误。

```sql
ANALYZE projects;
```

高偏斜 Tenant/Column 可提高 Statistics Target 或用 Extended Statistics 表达列相关性。

## 11. Parameter/Generic Plan

Prepared Statement 对不同 Tenant 可能复用 Generic Plan。小 Tenant 适合 Index，大 Tenant 可能适合 Seq Scan。极端数据倾斜需观察实际 Plan，不要只在小开发数据测试。

## 12. Mandatory 实验

生成 100k Project，分别：

1. 无组合索引查询；
2. 加 `(organization_id, created_at DESC, id DESC)`；
3. Offset 90000；
4. Keyset Cursor；
5. INCLUDE name；
6. 更新 name/批量 Insert 比较写成本。

报告：Execution Time、Rows、Buffers、Index Size、Insert Time。

## 13. Index 失效常见原因

- 对列包函数但无 Expression Index；
- 隐式类型转换；
- 前导 `%LIKE`；
- 返回比例太大；
- 组合索引左列缺失；
- Statistics 失真；
- Query `OR`/结构；
- 排序方向/NULL 顺序不匹配；
- Table 太小，Seq Scan 更便宜。

## 14. 生产建索引

普通 `CREATE INDEX` 可能阻塞写。`CREATE INDEX CONCURRENTLY` 降低锁影响但耗时更长、不能放普通 Transaction Block、失败可能留下 Invalid Index。Migration 工具需专门处理。

## 15. 验收问题

1. 为什么 Index 不是越多越好？
2. `(a,b)` 能否高效查询只有 b？
3. Partial Index 的 Query Predicate 为什么重要？
4. Index Only Scan 为什么不一定真的不访问 Heap？
5. Estimated/Actual Rows 差距说明什么？
6. 大 Tenant 和小 Tenant 为什么可能需要不同 Plan？
7. 为什么生产建 Index 要评审锁和 WAL？

---

[上一章：关系建模与 SQL](06-postgresql-schema-and-sql.md) · [返回模块目录](README.md) · [下一章：MVCC、事务与锁](08-postgresql-mvcc-transactions-locks.md)
