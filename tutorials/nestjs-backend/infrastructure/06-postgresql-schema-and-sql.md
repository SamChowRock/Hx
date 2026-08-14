# 关系建模与 SQL：类型、约束、Join、聚合和窗口函数

> [返回本模块目录](README.md)

## 1. Table 表达实体，Constraint 表达事实

当前模型：

```text
User ──< Membership >── Organization ──< Project
```

Membership 是关系实体，因为它有 Role、CreatedAt 和唯一性，不是简单数组。

## 2. 主键选择

UUID 优点：分布式生成、不暴露简单数量、合并数据容易。代价：更大、随机 UUID 对 B-tree Locality 较差。顺序 ID 小且局部性好，但可枚举且跨系统生成需协调。

选择要基于业务和存储，不是安全措施：即使 UUID 不可猜，仍必须授权。

## 3. 数据类型

### Text/Varchar

PostgreSQL 中无长度限制的 text 与 varchar 性能通常相近。业务长度仍应在 API 和必要数据库 Constraint 明确。

### Timestamp

- `timestamptz` 存绝对时刻，按 Session Time Zone 显示；
- `timestamp without time zone` 是无时区当地值；
- API 使用 UTC ISO 8601。

### Numeric/Money

金额使用最小单位 bigint/int 或 numeric；不要用 float。还要存 Currency 和 Rounding Rule。

### Enum

数据库 Enum 提供合法值，但增加/删除/重命名需 Migration。频繁变化或配置型数据也可用 Lookup Table + Foreign Key。

### JSONB

适合结构部分灵活、整体读取的附加数据；不适合把核心关系/权限全部塞进去。JSONB 内部约束、Join 和局部并发修改更复杂。

## 4. Constraint

- `NOT NULL`：值必须存在；
- `UNIQUE`：不重复；
- `PRIMARY KEY`：实体标识；
- `FOREIGN KEY`：引用存在；
- `CHECK`：行内条件；
- `EXCLUDE`：防时间段等重叠（高级）。

例：

```sql
CHECK (absolute_expires_at > created_at)
```

数据库 Constraint 对所有 API、Worker、CLI 和手工 SQL 生效。

## 5. Foreign Key 行为

- `ON DELETE CASCADE`：父删除时子删除；
- `SET NULL`：保留子记录但解除关系；
- `RESTRICT/NO ACTION`：仍有引用则拒绝。

Project 随 Organization Cascade 是否满足审计/合规保留，需要产品决定。Audit 对 User/Organization 使用 SetNull 可保留事件。

## 6. Normalization

避免重复事实：User Email 放 UserContact，不在每个 Membership 复制。否则改 Email 要更新多处并可能不一致。

常见到 3NF 已够多数业务：字段依赖 Key，不依赖其他非 Key 字段。性能需要时可反规范化，但要定义事实源和重建。

## 7. SELECT 基础

```sql
SELECT id, name, created_at
FROM projects
WHERE organization_id = $1
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

不要 `SELECT *` 作为长期 API 查询；未来大字段/敏感列会被无意加载。

## 8. JOIN

```sql
SELECT m.role, u.id, u.display_name
FROM memberships AS m
JOIN users AS u ON u.id = m.user_id
WHERE m.organization_id = $1;
```

- INNER JOIN：两边匹配；
- LEFT JOIN：保留左边，无匹配右边为 null；
- JOIN 条件错误会产生笛卡尔积/重复。

## 9. Aggregate

```sql
SELECT organization_id, count(*)
FROM projects
GROUP BY organization_id
HAVING count(*) > 100;
```

WHERE 在聚合前过滤，HAVING 在聚合后过滤。

## 10. Window Function

不折叠原 Row：

```sql
SELECT id,
       organization_id,
       created_at,
       row_number() OVER (
         PARTITION BY organization_id
         ORDER BY created_at DESC
       ) AS rank
FROM projects;
```

适合每 Tenant 排名、累计和前 N。

## 11. CTE

```sql
WITH active_members AS (
  SELECT * FROM memberships WHERE role <> 'VIEWER'
)
SELECT ... FROM active_members;
```

CTE 改善表达，也可用于递归/数据修改；是否 Materialize 与版本/写法有关，要看 Query Plan。

## 12. 参数化与 Injection

值必须参数化：

```sql
WHERE normalized_value = $1
```

字段名、排序方向不能作为普通参数，应使用 Allowlist 映射。不要拼接用户输入到 `$queryRawUnsafe`。

## 13. NULL 三值逻辑

`NULL = NULL` 不是 true。使用 `IS NULL`。Unique 对 NULL 行为也需理解；“可空唯一”可能允许多个 NULL。

API 中 omitted、null、empty string 语义要明确。

## 14. SQL 实验

用当前表完成：

1. 每个 Organization 的成员数；
2. 每种 Role 数量；
3. 最近创建的 3 个 Project/Tenant；
4. 没有 Project 的 Organization（LEFT JOIN）；
5. 有多个 Active Session 的 User；
6. Pending Outbox 的最老年龄；
7. 30 分钟内失败登录次数。

每条先写结果预期，再用 Prisma 实现等价查询或说明为什么原生 SQL 更合适。

## 15. 验收问题

1. 为什么 Membership 是独立 Table？
2. UUID 是否能替代授权？
3. Enum 与 Lookup Table 的取舍？
4. JSONB 何时不适合？
5. LEFT JOIN 的 Filter 放 WHERE 与 ON 有何差异？
6. NULL 为什么容易造成业务 Bug？
7. 数据库 Constraint 与 Zod 为什么都需要？

---

[上一章：PostgreSQL 运行架构](05-postgresql-mental-model.md) · [返回模块目录](README.md) · [下一章：索引与查询计划](07-postgresql-indexes-and-query-plans.md)
