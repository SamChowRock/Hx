# PostgreSQL、查询计划与数据演进

> [返回专家训练目录](README.md)

## 1. 目标

你需要从“会写 Prisma 查询”进阶到：

- 能从访问模式设计 Schema/Index；
- 能读 `EXPLAIN (ANALYZE, BUFFERS)`；
- 能发现 N+1、无界查询和低效分页；
- 能设计大表兼容 Migration；
- 能估算连接、锁、I/O 和写放大成本。

## 2. Query 设计从访问模式开始

为每个 Endpoint 写 Query Card：

```text
Endpoint: GET organization projects
Filter: organization_id = ?
Sort: created_at DESC, id DESC
Page size: <= 100
Selected columns: id, name, status, created_at
Expected tenant rows: p50 20 / p95 2,000 / max 100,000
Freshness: immediate
```

然后才判断 Index：

```sql
CREATE INDEX projects_org_created_id_idx
ON projects (organization_id, created_at DESC, id DESC);
```

## 3. 建立可重复的数据集

仅在本地专用测试数据库执行：

```sql
INSERT INTO organizations (id, name, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000999', 'Perf org', now(), now());

INSERT INTO projects (id, organization_id, name, created_at, updated_at)
SELECT gen_random_uuid(),
       '00000000-0000-0000-0000-000000000999',
       'Project ' || n,
       now() - (n || ' seconds')::interval,
       now()
FROM generate_series(1, 100000) AS n;

ANALYZE projects;
```

记录数据生成耗时和表/索引大小：

```sql
SELECT pg_size_pretty(pg_total_relation_size('projects'));
```

## 4. 读查询计划

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, name, created_at
FROM projects
WHERE organization_id = '00000000-0000-0000-0000-000000000999'
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

重点观察：

- `Seq Scan` 还是 `Index Scan`；
- Estimated Rows 与 Actual Rows 差异；
- 是否出现额外 Sort；
- `Rows Removed by Filter`；
- Shared Hit/Read Blocks；
- Planning/Execution Time；
- 是否回表读取大量 Heap Page。

不要只看“用了 Index”。如果返回表中大部分 Row，Seq Scan 可能更合理。

## 5. Mandatory Lab：Offset 与 Cursor 对比

执行：

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, name, created_at
FROM projects
WHERE organization_id = '00000000-0000-0000-0000-000000000999'
ORDER BY created_at DESC, id DESC
OFFSET 90000 LIMIT 20;
```

再执行 Keyset：

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, name, created_at
FROM projects
WHERE organization_id = '00000000-0000-0000-0000-000000000999'
  AND (created_at, id) < ($cursor_time, $cursor_id)
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

比较：扫描 Row、Buffer 和耗时。解释为什么大 Offset 越翻越慢，以及 Cursor 为什么要求稳定唯一排序。

## 6. Covering Index 与写成本

尝试 `INCLUDE (name)`：

```sql
CREATE INDEX ...
ON projects (organization_id, created_at DESC, id DESC)
INCLUDE (name);
```

观察是否出现 Index Only Scan。然后比较：

- Index 大小；
- 批量 Insert 时间；
- Update name 的成本；
- Vacuum/Visibility Map 对 Index Only 的影响。

结论不能只是“Covering Index 更快”，而要说明读写比例和存储代价。

## 7. N+1 实验

先写一个故意错误的 Service：列表取 Membership 后逐个查 User。记录 SQL 次数和延迟。再改为 Relation Select 或批量 `IN`，验证从 N+1 降到固定次数。

验收不是代码看起来更短，而是日志/Query Count 证明。

## 8. 大表 Migration 设计

需求：给 1 亿 Row Project 增加不可空 `slug` 且组织内唯一。

不能一步完成。设计：

1. 新增可空 Column；
2. 新应用双写 slug；
3. 分批 Backfill，按主键游标、限速、可重试；
4. 检查 null/duplicate；
5. 建组织内 Unique Index，生产考虑 Concurrently；
6. 添加 NOT NULL；
7. 切换读取；
8. 移除兼容逻辑。

写清每步的新旧应用兼容矩阵。

## 9. 连接池实验

观察活动：

```sql
SELECT state, count(*)
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY state;
```

故意在测试环境开启一个长事务，观察 `idle in transaction`、锁和连接占用。理解为什么长事务会阻止 Vacuum、占 Pool 并增加锁等待。

## 10. 验收产出

- Query Card；
- 10 万 Row 可重建数据脚本；
- Offset/Cursor 的 Explain 对比；
- Index 前后读写与存储报告；
- N+1 修复证据；
- Slug Expand/Contract 设计；
- Connection Budget 表。

## 11. 专家评审问题

1. 组合 Index 的左侧顺序为什么重要？
2. 为什么低选择性 Enum Index 可能无效？
3. Statistics 过期如何影响 Planner？
4. Partial Index 何时适合 Pending Outbox？
5. 为什么索引也会让写入和 Vacuum 更贵？
6. Read Replica 会带来什么一致性问题？
7. 如何避免 Tenant 数据量极端不均导致计划失真？
