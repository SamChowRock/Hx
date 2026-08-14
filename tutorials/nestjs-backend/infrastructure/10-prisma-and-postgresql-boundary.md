# 10｜Prisma 与 PostgreSQL 的边界：ORM 没有消灭数据库

> [返回本模块目录](README.md)
>
> 目标：能够利用 Prisma 提高研发效率，同时保留对 SQL、约束、事务、查询计划和生产迁移的控制力。

---

## 1. ORM 提供抽象，但数据库仍执行真实工作

Prisma 让 TypeScript 代码可以这样访问数据：

```ts
const user = await prisma.user.findUnique({
  where: { email },
});
```

但运行时仍然发生：

1. Prisma 把调用转换为数据库请求；
2. PostgreSQL 解析 SQL；
3. 规划器选择扫描、连接和排序方式；
4. 执行器读取页面和索引；
5. MVCC 判断哪些行对当前事务可见；
6. 锁、WAL、约束和事务保证正确性；
7. 结果被转换回 JavaScript 对象。

因此：

```text
Prisma API 易用性 ≠ 查询天然高效
TypeScript 类型安全 ≠ 数据库约束
Prisma transaction ≠ 可以忽略隔离级别和锁
migration 文件存在 ≠ 生产迁移安全
```

成熟的使用方式是：把 Prisma 当作开发接口，把 PostgreSQL 当作数据正确性和执行行为的最终权威。

---

## 2. 本项目中的 Prisma 组件分别负责什么

按项目实际文件阅读以下组成：

- `prisma/schema.prisma`：数据模型、关系、生成器与数据源描述；
- `prisma/migrations/`：已经形成历史的数据库结构变更；
- `PrismaService`：应用生命周期内复用 Prisma Client；
- repository/service：定义业务需要的数据操作；
- 生成的 Prisma Client：提供类型和查询 API；
- PostgreSQL：保存真实 schema、约束、索引和数据。

一个常见误区是认为 `schema.prisma` 是数据库本身。它只是应用侧模型来源之一。数据库中可能还有：

- Prisma schema 不完全表达的索引；
- 触发器、函数和视图；
- 扩展与自定义类型；
- 手写约束；
- 行级安全策略；
- 独立系统创建的对象。

所以必须区分三种状态：

```text
期望模型：schema.prisma
变更历史：migrations
真实状态：PostgreSQL catalog
```

三者不一致就会产生 schema drift。

---

## 3. Prisma schema 如何映射到 PostgreSQL

下面是一个概念示例：

```prisma
model User {
  id        String   @id @default(uuid()) @db.Uuid
  email     String   @unique
  name      String?
  createdAt DateTime @default(now()) @map("created_at")

  @@map("users")
}
```

它表达了：

- `id` 是主键；
- 数据库列使用 UUID 类型；
- `email` 必须唯一；
- `name` 允许 NULL；
- `created_at` 由数据库默认生成；
- Prisma 模型名和数据库表名可以不同。

你仍然应该打开 migration SQL，确认最终数据库定义是否符合预期。例如：

- `String` 最终是 `text`、`varchar(n)` 还是 UUID；
- 外键删除策略是 `RESTRICT`、`CASCADE` 还是 `SET NULL`；
- 时间列是否使用 `timestamp with time zone`；
- 唯一性由约束还是普通索引表达；
- 索引列顺序是否匹配查询；
- 默认值在数据库生成还是应用生成。

### 3.1 可空性是业务语义

```prisma
name String?
```

不只是 TypeScript 得到 `string | null`，它还表示数据库允许未知/缺失。可空字段会影响：

- 唯一约束对多个 NULL 的处理；
- 聚合和比较；
- 排序；
- API 是否区分“未提供”“清空”和“空字符串”。

不要为了绕过迁移困难而随意把新列设成可空，然后永远不补约束。

### 3.2 数据库默认值与应用默认值

数据库默认值适用于所有写入来源，包括脚本、后台任务和其他服务；应用默认值只适用于经过这段应用代码的写入。

如果一个默认值属于数据不变量，例如创建时间，数据库默认通常更稳健。如果默认值依赖当前用户、请求语言或业务规则，则更可能由应用层决定。

---

## 4. 约束是最后一道并发防线

假设注册前先查询邮箱是否存在：

```ts
const existing = await prisma.user.findUnique({ where: { email } });

if (existing) {
  throw new ConflictException('邮箱已存在');
}

await prisma.user.create({ data: { email } });
```

两个并发请求可以同时查到“不存在”，随后同时创建。只有数据库唯一约束能够在最终提交点阻止重复。

正确分工是：

1. 应用预检查用于提供较好的普通路径错误；
2. 数据库约束保证并发下永远不破坏不变量；
3. 应用捕获唯一约束错误，并转换为稳定的领域/API 错误。

类似地：

- 外键维护引用完整性；
- `NOT NULL` 防止缺失；
- `CHECK` 限制合法范围；
- 事务保证多步状态变更原子性。

DTO 校验只能证明某次 API 输入格式合法，不能约束其他写入路径，也不能解决并发竞争。

---

## 5. `select`、`include` 与数据边界

### 5.1 不要无意识返回完整记录

```ts
const user = await prisma.user.findUnique({
  where: { id },
  select: {
    id: true,
    email: true,
    name: true,
  },
});
```

显式 `select` 的价值不只是少传几列：

- 防止密码摘要、内部状态等敏感列被意外带出；
- 减少行宽和网络传输；
- 让 repository 的返回契约更稳定；
- schema 新增字段时不会自动扩大 API 暴露面。

### 5.2 `include` 不等于免费 JOIN

```ts
await prisma.user.findMany({
  include: {
    posts: true,
  },
});
```

要问：

- 实际发出了几条 SQL；
- 关系由 JOIN 还是多查询加载；
- 一个用户可能有多少 posts；
- 是否把整个一对多集合拉进内存；
- 能否分页、聚合或只选择需要字段。

API 返回 20 个用户，但每人带 1 万条事件，类型上完全合法，系统上却不可接受。

---

## 6. N+1 查询是如何产生的

典型写法：

```ts
const users = await prisma.user.findMany();

const result = await Promise.all(
  users.map(async (user) => ({
    ...user,
    posts: await prisma.post.findMany({
      where: { authorId: user.id },
    }),
  })),
);
```

如果先执行 1 条用户查询，再为 N 个用户分别执行 N 条文章查询，就是 N+1。

问题不只在数据库计算量：每条查询还要经历连接池排队、网络往返、SQL 解析与结果转换。常见改法：

- 使用关系查询并审查实际 SQL；
- 先收集 ID，再用 `WHERE author_id IN (...)` 批量查询；
- 使用 DataLoader 在一个请求周期内批处理；
- 直接写适合当前读模型的 SQL；
- 对列表接口返回聚合结果，而非完整子集合。

识别 N+1 的最好方式是观察每个请求的查询数量，而不只是查看某一条 SQL 的耗时。

---

## 7. 分页：offset 简单，但不是永远正确

### 7.1 Offset 分页

```ts
await prisma.post.findMany({
  skip: (page - 1) * pageSize,
  take: pageSize,
  orderBy: { createdAt: 'desc' },
});
```

优点是容易跳页，适合较小数据集和后台管理。问题包括：

- 深页需要扫描并丢弃前面大量行；
- 并发插入或删除时，用户可能看到重复或漏项；
- 只有 `createdAt` 相同时，排序不稳定。

至少应提供唯一的次级排序：

```ts
orderBy: [{ createdAt: 'desc' }, { id: 'desc' }];
```

### 7.2 Cursor/Keyset 分页

概念 SQL：

```sql
SELECT id, title, created_at
FROM posts
WHERE (created_at, id) < ($1, $2)
ORDER BY created_at DESC, id DESC
LIMIT $3;
```

配合 `(created_at DESC, id DESC)` 索引，它可以从游标位置继续扫描，不必跳过前面所有行。它更适合信息流和大数据集，但不能天然跳到任意页。

选择分页方式是产品语义和查询成本的共同决策，不是 ORM API 偏好。

---

## 8. Prisma 事务的三种使用层次

### 8.1 单条写入

单条 `INSERT` / `UPDATE` 本身就是原子的。不要为了形式感给每条单独更新都包装复杂事务。

### 8.2 批量事务

多个互不依赖的 Prisma 操作可以作为一个事务提交：

```ts
await prisma.$transaction([
  prisma.auditLog.create({ data: auditData }),
  prisma.user.update({ where: { id }, data: userData }),
]);
```

### 8.3 交互式事务

后一步依赖前一步结果或需要条件判断时：

```ts
await prisma.$transaction(async (tx) => {
  const account = await tx.account.findUniqueOrThrow({
    where: { id: accountId },
  });

  if (account.balance < amount) {
    throw new Error('余额不足');
  }

  await tx.account.update({
    where: { id: accountId },
    data: { balance: { decrement: amount } },
  });
});
```

但这个示例在默认隔离下仍可能遭遇并发竞争。两个事务都可能读到足够余额。可选方案包括：

- 用一条带条件的更新并检查影响行数；
- 使用更高隔离级别并对序列化失败重试；
- 使用行锁；
- 重新设计为不可变账本和约束，而非直接覆盖余额。

ORM 的事务回调只提供事务边界，无法替你决定并发控制策略。

### 8.4 事务中不要做远程 I/O

不推荐：

```text
BEGIN
  更新数据库
  调用支付平台，等待 3 秒
  发送邮件
COMMIT
```

远程调用不可控，会让事务和锁持有更久，而且数据库回滚无法撤销已经成功的外部调用。通常应使用 outbox、状态机、幂等消费和补偿机制解耦。

---

## 9. 用条件更新消除“先查后改”的窗口

库存扣减可以写成：

```ts
const result = await prisma.product.updateMany({
  where: {
    id: productId,
    stock: { gte: quantity },
  },
  data: {
    stock: { decrement: quantity },
  },
});

if (result.count !== 1) {
  throw new ConflictException('库存不足');
}
```

数据库执行的是一条条件更新。判断与修改处在同一语句内，比“先 SELECT 再 UPDATE”少一个竞争窗口。

但仍需考虑：

- 是否允许库存为负，数据库是否有 `CHECK (stock >= 0)`；
- 同一个业务请求重试是否会重复扣减；
- 多商品扣减如何保持原子性；
- 热门商品是否形成单行锁热点。

---

## 10. Raw SQL：必要工具，而不是失败标志

ORM 难以优雅表达以下能力时，手写 SQL 很合理：

- 窗口函数；
- 复杂 CTE；
- PostgreSQL 特有操作符；
- 精细的锁语义；
- 批量数据处理；
- 只读报表；
- `EXPLAIN` 与诊断查询。

参数化调用示意：

```ts
const rows = await prisma.$queryRaw<ReportRow[]>`
  SELECT
    user_id,
    count(*)::int AS order_count,
    sum(total) AS total_amount
  FROM orders
  WHERE created_at >= ${startAt}
  GROUP BY user_id
  ORDER BY total_amount DESC
  LIMIT ${limit}
`;
```

模板标签会把值作为参数处理。不要把用户输入拼进 SQL 字符串：

```ts
// 危险：不要这样做
const sql = `SELECT * FROM users WHERE email = '${email}'`;
```

动态表名、列名和排序方向不能像普通值一样参数化，必须由代码端白名单映射：

```ts
const orderColumn = {
  newest: 'created_at',
  amount: 'total_amount',
}[sortKey];
```

即便使用白名单，也应把动态 SQL 封装在基础设施层并进行测试与审查。

---

## 11. Prisma 不完全表达的 PostgreSQL 能力

实际项目经常需要在 migration SQL 中保留数据库原生能力，例如：

- partial index；
- expression index；
- `CREATE INDEX CONCURRENTLY`；
- extension；
- view / materialized view；
- trigger / function；
- exclusion constraint；
- row-level security；
- 特定 `CHECK` 约束；
- 分区表；
- 自定义 enum/domain。

这不表示需要放弃 Prisma。合理边界是：

- 常规 CRUD 和类型生成继续使用 Prisma；
- 数据库特有的结构通过可审查的 SQL migration 管理；
- 应用代码不假装这些数据库能力不存在；
- 测试环境使用真实 PostgreSQL 验证，而不是行为不同的替代数据库。

---

## 12. Migration 的开发与生产语义不同

### 12.1 开发阶段

开发命令可以帮助生成 migration、使用 shadow database 检测变更并重置本地环境。它假设开发者有较高权限，也可能提示重置数据。

### 12.2 生产部署

生产只应应用已经评审并提交的 migration，不应临时根据 schema 自动推断和生成变更。部署账号权限、锁等待和失败处理都要明确。

基本流程：

```text
修改 schema
  -> 生成 migration
  -> 阅读 SQL
  -> 在真实 PostgreSQL 数据规模上验证
  -> 代码评审
  -> 备份/回滚或 roll-forward 方案
  -> 生产部署前执行或分阶段执行
  -> 验证 schema 与指标
```

### 12.3 为什么必须阅读 migration SQL

一个看似简单的字段修改可能导致：

- 整表重写；
- 长时间强锁；
- 旧数据无法转换；
- 新旧应用版本无法同时运行；
- 索引长时间构建；
- 默认值回填引发大量 WAL；
- 表变大后执行时间从毫秒变成小时。

ORM 知道模型差异，但不知道你的发布流量、表规模、SLO 和兼容窗口。

---

## 13. Expand/Contract：让 schema 变化兼容滚动发布

把“重命名字段 `name` 为 `display_name`”直接写成一次 rename，会导致旧应用版本在滚动发布期间失败。更安全的做法通常是：

### Expand

1. 新增 `display_name`，先允许为空；
2. 发布同时兼容旧列和新列的应用；
3. 双写或通过明确的数据同步策略保持一致；
4. 分批回填历史数据；
5. 加验证与约束。

### Migrate

6. 所有读流量切到新列；
7. 观察完整业务周期；

### Contract

8. 停止旧列写入；
9. 删除旧列和兼容代码。

这会增加短期复杂度，但换来版本共存和可回退空间。数据库迁移的单位往往不是“一次 SQL”，而是跨多个发布的状态机。

---

## 14. 类型转换中的边界

### 14.1 `bigint`

JavaScript `number` 不能精确表示所有 64 位整数。数据库 `bigint` 应明确使用 `bigint`、字符串或经过约束的转换，API JSON 序列化也需要处理。

### 14.2 `numeric/decimal`

金额不要随意转成 JavaScript 浮点数。`0.1 + 0.2` 的二进制浮点问题可能破坏精确计算。使用 Prisma Decimal 或在边界处使用字符串/最小货币单位，并明确舍入规则。

### 14.3 时间

需要区分：

- 某个绝对时刻；
- 某地日历时间；
- 日期；
- 时区规则。

数据库、Node.js、容器和用户时区如果不一致，很容易产生“看起来差 8 小时”的问题。存储绝对时刻时通常使用带时区语义的类型并统一按 UTC 传输；展示时再应用用户时区。

### 14.4 JSONB

JSONB 适合结构变化较大或不需要强关系约束的数据，但不应成为“懒得建模”的默认选择。把核心可查询字段塞进 JSON 会失去清晰约束、类型演化和简单索引设计。

---

## 15. 错误映射：不要把 ORM 错误泄漏给 API

数据库/Prisma 错误应该在基础设施边界被识别，再转换为领域可理解的错误：

| 底层情况        | 对外语义示例                             |
| --------------- | ---------------------------------------- |
| 唯一约束冲突    | `409 Conflict`，资源已经存在             |
| 外键冲突        | `409` 或业务校验错误                     |
| 目标记录不存在  | `404 Not Found`                          |
| 序列化失败/死锁 | 内部按策略重试，耗尽后返回可重试错误     |
| 连接/超时       | `503 Service Unavailable` 或内部错误策略 |
| 未知数据库错误  | `500`，记录关联 ID，不泄漏 SQL 和凭据    |

不要只按错误消息字符串判断；优先使用稳定错误码和约束名。约束命名清晰会让错误映射更可靠。

---

## 16. 可观测性：怎样看见 Prisma 背后的数据库行为

开发和测试环境可按需记录：

- 查询模板或操作名；
- 查询耗时；
- 一次请求的查询数量；
- 连接池等待；
- 错误码；
- request/trace ID。

生产中不要默认记录完整参数，因为参数可能包含密码、令牌、邮箱和业务敏感数据。应做脱敏、采样和访问控制。

观察 ORM 性能至少有三个层次：

1. **HTTP 层**：哪个端点慢；
2. **ORM 层**：端点执行了多少次数据库操作，各耗时多久；
3. **PostgreSQL 层**：真实 SQL 的执行计划、I/O、锁等待和行数估算。

只看其中一个层次，很容易把连接池等待误判为 SQL 慢，或把 N+1 误判为单条查询慢。

---

## 17. 实验一：把 Prisma 查询还原成数据库问题

选择项目中的一个列表接口：

1. 找到 controller、service、repository/Prisma 调用；
2. 写出它需要的数据和排序语义；
3. 开启仅限本地的查询日志；
4. 请求接口一次，记录 SQL 数量与耗时；
5. 将最关键 SQL 放入 `EXPLAIN (ANALYZE, BUFFERS)`；
6. 对照实际筛选、排序和索引；
7. 修改查询或索引后重新测量；
8. 关闭可能泄漏参数的详细日志。

验收产物不是一句“加索引更快”，而应包括：

- 修改前后的执行计划；
- 实际行数与估算行数；
- 缓冲区读取；
- 请求内查询条数；
- 为什么选择这个索引列顺序。

---

## 18. 实验二：人为制造 N+1 再修复

1. 准备至少 20 个父记录，每个包含多个子记录；
2. 先用循环逐个查询子记录；
3. 记录总 SQL 数、总耗时和连接池峰值；
4. 改为批量查询或合适的关系加载；
5. 验证返回数据完全一致；
6. 添加一个测试或度量，避免未来退化。

关键不是记住某个 Prisma 参数，而是学会把 API 返回结构转换为“数据库需要做多少次往返、读取多少行”。

---

## 19. 实验三：设计一次兼容迁移

给现有核心表增加一个未来必须 `NOT NULL` 的字段：

1. 估算表行数和写入速率；
2. 设计 expand/contract 阶段；
3. 生成并阅读 migration SQL；
4. 设计分批回填脚本的批次和节流；
5. 设计新旧应用版本的读写兼容；
6. 设计约束验证；
7. 写出失败后的 roll-forward 方案；
8. 在本地真实 PostgreSQL 上演练。

不要求把这个练习应用到项目主 schema；可以在隔离实验表中完成，避免污染真实业务模型。

---

## 20. 达到成熟 Prisma 使用者的自检题

你应当能回答：

- `schema.prisma`、migration 和真实数据库为什么可能漂移；
- DTO 校验、应用预检查和数据库约束分别解决什么；
- `include` 为什么可能造成数据爆炸或 N+1；
- offset 与 cursor 分页的正确性和成本差异；
- Prisma 事务为何没有自动解决并发竞争；
- 什么时候应使用条件更新、锁或更高隔离级别；
- 为什么事务中不应等待远程服务；
- 哪些 PostgreSQL 能力应保留为手写 migration；
- 为什么生产 migration 必须人工阅读 SQL；
- 如何把一个慢 Prisma 调用追踪到真实执行计划。

下一章会把 Docker、PostgreSQL、Prisma 和 NestJS 串成一组完整实验。你需要制造故障、收集证据并证明恢复，而不只是阅读概念。

---

[上一章：PostgreSQL 生产运维与恢复](09-postgresql-operations-and-recovery.md) · [返回模块目录](README.md) · [下一章：综合实验与故障演练](11-integrated-labs.md)
