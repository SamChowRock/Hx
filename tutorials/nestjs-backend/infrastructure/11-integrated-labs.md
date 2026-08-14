# 11｜Docker × PostgreSQL × NestJS 综合实验与故障演练

> [返回本模块目录](README.md)
>
> 目标：把知识转化为可操作能力。完成本章后，你应该能够从容器、网络、数据库、ORM 和应用五个层次定位问题，并用证据验证修复。

---

## 0. 实验安全边界

以下实验会停止容器、制造锁、创建大量测试数据、备份和恢复数据库。开始前确认：

- 当前使用的是本项目本地开发环境；
- 没有连接共享测试库或生产库；
- 重要本地数据已经备份；
- 你知道 Compose 的 project name 和 volume 名；
- 每条删除命令的目标都能精确解释。

特别注意：

```bash
docker compose down
```

默认停止并删除 Compose 容器和网络，但保留 named volume。

```bash
docker compose down -v
```

会进一步删除 Compose 声明的 volume，数据库数据通常也会被删除。除非实验明确要求从空数据库开始并且你确认数据可丢弃，否则不要使用 `-v`。

建议为实验准备独立环境文件或独立 Compose project name，避免与日常开发数据混用。

---

## 1. 实验记录模板

每个实验都按以下格式记录，而不是只保存命令历史：

```md
## 假设

我认为故障原因是……

## 操作

执行了哪些命令，修改了哪些配置。

## 证据

容器状态、日志、SQL、执行计划、指标和时间线。

## 结论

假设是否成立，真正原因是什么。

## 恢复

如何恢复正常，如何确认数据与服务正确。

## 防复发

应该增加什么约束、探针、告警、测试或文档。
```

这个模板训练的是生产排障最核心的习惯：把猜测和事实分开。

---

## 2. 实验一：容器删除后，数据为什么还在

### 目标

证明容器可替换，持久数据由 volume 保存；同时理解“停止容器”“删除容器”“删除 volume”的差异。

### 步骤

1. 启动本项目数据库：

   ```bash
   docker compose up -d postgres
   ```

2. 写入带有唯一标记的数据；可以走 API，也可以新建隔离实验表。

3. 查看服务和 volume：

   ```bash
   docker compose ps
   docker volume ls
   ```

4. 停止并删除 Compose 容器，但保留 volume：

   ```bash
   docker compose down
   ```

5. 重新启动：

   ```bash
   docker compose up -d postgres
   ```

6. 查询唯一标记，确认数据仍然存在。

### 你应该解释

- 容器 writable layer 为什么消失；
- named volume 为什么仍存在；
- Compose 如何把原 volume 重新挂载到新容器；
- 为什么“数据库跑在容器里”不等于“数据应该写在容器层”。

### 进阶验证

用 `docker inspect` 找到 mount 的类型、source 和 destination。不要进入 Docker 内部目录手工修改 volume 文件。

---

## 3. 实验二：`localhost` 为什么在容器里失效

### 目标

建立宿主机网络和 Compose 网络的坐标系。

### 步骤

1. 确认数据库 service 名，例如 `postgres`；
2. 在宿主机连接数据库，host 使用 `localhost`，port 使用发布到宿主机的端口；
3. 在 API 容器中把 `DATABASE_URL` 的 host 临时配置成 `localhost`；
4. 观察 API 的连接失败日志；
5. 将 host 改为 Compose service 名，例如 `postgres`；
6. 重建/重启 API 容器并验证连接。

### 结论模型

```text
宿主机中的 localhost = 宿主机
API 容器中的 localhost = API 容器自身
Compose 网络中的 postgres = 数据库容器地址
```

### 验收

画出并标注：

- 浏览器到 API 的连接；
- 宿主机端口映射；
- API 到 PostgreSQL 的容器网络连接；
- 哪些通信需要 `ports`，哪些不需要。

---

## 4. 实验三：进程已启动，但服务还没准备好

### 目标

区分容器 running、进程存活、TCP 可连接、数据库 ready、应用 ready。

### 步骤

1. 查看当前 Compose 的 `depends_on` 和 healthcheck；
2. 从空的实验环境同时启动 API 和数据库；
3. 记录启动时间线：容器 created、running、数据库 ready、迁移完成、API ready；
4. 给数据库添加基于 `pg_isready` 的 healthcheck；
5. 让 API 的启动依赖健康条件，或在应用中加入有上限的重试；
6. 再次启动并比较日志。

### 关键问题

- `depends_on` 是否只保证启动顺序；
- healthcheck 检查的是进程还是实际依赖；
- 应用启动时自动跑 migration 会引入什么并发问题；
- 数据库短暂不可用时，API 应退出让编排重启，还是持续重试；
- readiness 失败是否应该让存活探针也失败。

健康检查不是越多越好。探针语义错误会让编排系统在依赖抖动时反复杀死原本可以恢复的进程。

---

## 5. 实验四：Dockerfile 缓存与最小运行镜像

### 目标

证明 Dockerfile 指令顺序如何影响构建速度，并检查运行镜像是否包含不必要内容。

### 步骤

1. 无缓存构建一次镜像并记录耗时；
2. 不改代码再次构建，观察缓存命中；
3. 只修改一个业务 `.ts` 文件再构建；
4. 修改 lockfile 后再构建；
5. 比较哪些 layer 失效；
6. 查看最终镜像的用户、入口、环境变量和文件；
7. 检查是否意外包含源码、测试、`.env`、Git 历史或开发依赖。

### 验收问题

- 为什么先复制依赖清单、安装依赖，再复制源码；
- 为什么 lockfile 变化理应使依赖 layer 失效；
- multi-stage build 如何减少最终镜像内容；
- 最终进程是否以非 root 用户运行；
- 镜像中是否存在构建期秘密。

不要为了追求极小体积而删除运行时实际需要的 CA 证书、时区数据或 native library。最小镜像的目标是可理解、可维护的最小攻击面。

---

## 6. 实验五：优雅退出与事务中断

### 目标

验证 NestJS 进程收到 SIGTERM 时，是否停止接收新请求、完成有限时间内的在途请求，并关闭数据库连接。

### 准备

创建一个仅限开发环境的测试端点或脚本：

1. 开始请求；
2. 执行一段可控的延迟工作；
3. 可选地开启一个短事务；
4. 返回结果。

### 步骤

1. 启动 API 容器；
2. 发起一个正在执行的请求；
3. 运行：

   ```bash
   docker compose stop api
   ```

4. 观察停止超时、Nest 生命周期日志和客户端结果；
5. 查看 PostgreSQL 中相应会话是否关闭、事务是否提交或回滚；
6. 检查容器退出码。

### 应验证

- Node 是否为容器 PID 1，信号是否直达；
- Nest 是否启用了 shutdown hooks；
- HTTP server 何时停止接受连接；
- Prisma/连接池是否被关闭；
- 超过优雅退出期限的请求会怎样；
- 重试是否会造成重复写入。

这个实验会把“优雅停机”和“幂等性”联系起来：客户端没收到响应，并不代表数据库没有提交。

---

## 7. 实验六：用执行计划证明索引有效

### 目标

不凭感觉加索引，用真实数据分布和执行计划做判断。

### 准备隔离表

在本地实验数据库创建一张专用表，避免污染业务表：

```sql
CREATE TABLE infra_lab_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id integer NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
```

生成足够数据：

```sql
INSERT INTO infra_lab_events (tenant_id, status, created_at)
SELECT
  1 + (random() * 99)::integer,
  CASE WHEN random() < 0.9 THEN 'done' ELSE 'pending' END,
  now() - random() * interval '90 days'
FROM generate_series(1, 200000);
```

更新统计信息：

```sql
ANALYZE infra_lab_events;
```

### 基准查询

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, status, created_at
FROM infra_lab_events
WHERE tenant_id = 42
  AND status = 'pending'
ORDER BY created_at DESC
LIMIT 20;
```

记录：

- 节点类型；
- 估算行数与实际行数；
- 是否发生排序；
- shared buffers hit/read；
- planning/execution time。

### 设计索引

```sql
CREATE INDEX infra_lab_events_tenant_status_created_idx
ON infra_lab_events (tenant_id, status, created_at DESC);
```

再次运行相同 `EXPLAIN`，比较证据。

### 深入变化

继续试验：

- 只按 `status` 查询；
- 查询占全表 90% 的 `done`；
- 去掉 tenant 条件；
- 把索引列顺序换掉；
- 建立只覆盖 `pending` 的 partial index；
- 请求一个索引未覆盖的大 payload。

你应能解释为什么同一个索引不会优化所有变化。

### 清理

```sql
DROP TABLE infra_lab_events;
```

只删除实验表，不要删除整个开发 schema。

---

## 8. 实验七：观察 MVCC 与长事务

### 目标

亲眼看到不同事务快照、dead tuples 和长事务之间的联系。

### 两会话实验

在两个 `psql` 会话中操作隔离实验表。

会话 A：

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT * FROM infra_lab_accounts WHERE id = 1;
```

会话 B 更新并提交：

```sql
UPDATE infra_lab_accounts
SET balance = balance + 100
WHERE id = 1;
```

回到会话 A 再查询。它仍可能看到事务开始时的旧版本。然后：

1. 查询 `pg_stat_activity` 中 A 的 `xact_start`；
2. 在 B 进行多次更新；
3. 观察 dead tuple 统计；
4. 对比 A 提交前后 vacuum 可做的工作。

### 需要回答

- 旧行版本为什么暂时不能回收；
- 长事务为什么会导致表和索引膨胀；
- 为什么 `idle in transaction` 是重要告警；
- 为什么杀掉长事务前仍要确认业务影响。

实验结束必须 `COMMIT` 或 `ROLLBACK`，不要把会话长时间悬挂。

---

## 9. 实验八：锁等待与死锁

### 目标

区分“数据库很慢”和“查询正在等待锁”，并学习通过固定加锁顺序避免死锁。

### 制造锁等待

会话 A：

```sql
BEGIN;
UPDATE infra_lab_accounts SET balance = balance - 10 WHERE id = 1;
```

保持事务不提交。会话 B：

```sql
BEGIN;
UPDATE infra_lab_accounts SET balance = balance + 10 WHERE id = 1;
```

会话 B 会等待。使用第三个会话查询 `pg_stat_activity`、`pg_locks` 和阻塞 PID。

### 制造死锁

会话 A 先更新 id=1，会话 B 先更新 id=2，然后双方尝试更新对方已锁住的行。PostgreSQL 会检测死锁并中止其中一个事务。

### 修复原则

- 多资源操作统一按稳定顺序加锁，例如账户 ID 升序；
- 事务尽量短；
- 不在事务中等待用户输入或远程 HTTP；
- 设置合理 `lock_timeout`；
- 对明确可重试的死锁/序列化失败使用有上限、带抖动的重试；
- 业务操作仍需幂等。

### 验收

提交一份阻塞树，包括阻塞者、等待者、SQL、事务开始时间和解除方式。不要仅记录“重启后好了”。

---

## 10. 实验九：连接池耗尽如何传播到 HTTP

### 目标

理解数据库连接饱和如何变成接口排队和超时。

### 步骤

1. 在隔离配置中把连接池设置得很小；
2. 准备一个会占用数据库连接数秒的开发测试请求；
3. 并发发起超过池大小的请求；
4. 同时观察：
   - HTTP 延迟和错误；
   - 应用连接池指标；
   - `pg_stat_activity`；
   - PostgreSQL 实际执行中的查询数量；
5. 调整 pool timeout、statement timeout 和请求超时；
6. 再次实验。

### 关键结论

如果池大小是 5，20 个并发请求不等于数据库同时执行 20 条查询。剩余请求可能在应用进程中排队。只看 `pg_stat_activity` 会低估用户实际等待。

### 设计题

给定：

- 数据库最大连接 150；
- 预留 30；
- API 最多 12 个实例；
- 每个实例另有 2 个后台任务连接；

计算 API 主池上限，并说明为什么还应留安全余量。然后讨论增加 PgBouncer 后哪些预算改变、哪些数据库瓶颈没有改变。

---

## 11. 实验十：备份成功不等于恢复成功

### 目标

从“生成备份文件”走到“业务可验证的独立恢复”。

### 步骤

1. 创建唯一标记数据，并记录当前 migration 版本和关键表行数；
2. 用 `pg_dump -Fc` 创建备份；
3. 记录文件大小、校验和、创建时间和 PostgreSQL 版本；
4. 创建新的恢复数据库；
5. 用 `pg_restore` 恢复；
6. 运行验证 SQL；
7. 让本地 API 临时连接恢复库并运行只读 smoke test；
8. 记录从开始恢复到应用验证通过的总时间；
9. 删除这次实验数据库，但保留演练报告。

### 故意加入一次失败

可以选择一个安全故障：

- 使用错误数据库名；
- 缺少需要的 extension；
- 恢复角色权限不足；
- 恢复后应用连接仍指向旧数据库。

记录错误如何表现、监控是否发现、runbook 是否足以修复。

### 验收

- 恢复目标是新数据库，不覆盖源库；
- 核心约束、索引和 migration 历史存在；
- 唯一标记存在；
- 应用使用运行账号能读取；
- RTO 有实测值，而不是估计值。

---

## 12. 实验十一：慢接口的五层排查

### 场景

一个列表接口 P95 从 100ms 升到 4s。请严格按层次收集证据。

### 第一层：客户端与 HTTP

- 是否所有请求都慢；
- DNS、TLS、代理和传输用了多久；
- 状态码、超时和响应大小；
- 是否只有特定查询参数触发。

### 第二层：NestJS 应用

- request/trace ID；
- controller/service 各阶段耗时；
- 事件循环是否阻塞；
- 是否有远程依赖重试；
- 容器 CPU throttling 或 OOM 压力。

### 第三层：Prisma 与连接池

- 一次请求执行多少条查询；
- 是否在等待池连接；
- 是否出现 N+1；
- 返回行数和对象体积；
- ORM 是否进行了额外关系查询。

### 第四层：PostgreSQL

- SQL 执行时间；
- `EXPLAIN (ANALYZE, BUFFERS)`；
- 锁等待；
- 统计信息是否失准；
- 临时文件、排序、I/O 和缓存；
- 长事务与 vacuum 状态。

### 第五层：Docker 与宿主资源

- 容器 CPU/内存限制；
- 磁盘空间和 I/O；
- 网络错误；
- 容器重启与健康状态；
- 日志驱动是否占满磁盘。

### 最终报告

报告中必须明确：

- 根因；
- 放大因素；
- 临时止血；
- 永久修复；
- 验证指标；
- 防回归措施。

“给数据库加机器”不是合格结论，除非证据证明资源饱和就是主要约束，并且扩容后的计划和瓶颈已经验证。

---

## 13. 综合毕业项目：把本地栈提升到可评审的生产设计

不要求真的部署生产，但要针对本项目提交一份可执行设计。

### 13.1 容器交付

- multi-stage Dockerfile；
- 可复现依赖安装；
- 非 root 运行；
- 正确的 PID 1 与优雅退出；
- 合理的 health/readiness；
- 不在镜像内包含秘密；
- 镜像版本和回滚策略；
- CPU/内存限制与 OOM 行为说明。

### 13.2 数据库设计

- 每张核心表的不变量和约束；
- 查询模式与对应索引；
- 分页策略；
- 事务边界与并发控制；
- 连接总预算；
- 超时配置；
- migration expand/contract 方案。

### 13.3 运维恢复

- 指标、日志、追踪和告警；
- 备份类型、频率、保留和加密；
- RPO/RTO；
- 恢复 runbook；
- 最近一次恢复演练证据；
- 主库故障和误删数据分别如何处理；
- 副本一致性策略。

### 13.4 故障注入

至少演示三类：

1. 数据库暂时不可用；
2. 长事务或锁等待；
3. 容器 SIGTERM/重启；
4. 可选：连接池耗尽、磁盘逼近上限或慢查询。

### 13.5 评审标准

| 维度       | 了解       | 熟练                           | 专家倾向                            |
| ---------- | ---------- | ------------------------------ | ----------------------------------- |
| Docker     | 能启动容器 | 能解释网络、volume、构建和信号 | 能设计安全交付、资源边界与故障恢复  |
| PostgreSQL | 会 CRUD    | 能读计划、设计索引、处理锁     | 能权衡并发、运维、HA 与恢复目标     |
| Prisma     | 会调用 API | 能控制查询、事务、迁移         | 能明确 ORM 边界并使用原生数据库能力 |
| 排障       | 看日志猜测 | 分层收集证据                   | 建立时间线、验证假设并系统性防复发  |
| 恢复       | 知道要备份 | 能完成独立恢复                 | 用演练证明 RPO/RTO，并持续自动验证  |

---

## 14. 完成本模块后的能力清单

只有在你能亲自完成并解释以下事项时，才算真正学会：

- 从镜像、容器、网络、volume 四层解释本地环境；
- 编写可缓存、可复现、非 root 的 multi-stage Dockerfile；
- 解释 SIGTERM、PID 1、优雅停机和请求重试的关系；
- 为 PostgreSQL 表设计约束，而不只依赖 DTO；
- 用 `EXPLAIN (ANALYZE, BUFFERS)` 证明索引是否有效；
- 观察 MVCC、长事务、锁等待和死锁；
- 做应用实例数量与连接池的统一预算；
- 区分逻辑备份、物理备份、副本和高可用；
- 恢复到隔离数据库并进行业务验证；
- 把 Prisma 调用还原为 SQL、执行计划和事务语义；
- 设计兼容滚动发布的 migration；
- 对一个慢接口完成五层证据链排查。

如果其中某一项只能复述定义、不能独立演示，就回到对应章节重新完成实验。专家能力不是记住更多术语，而是能够在约束、并发和故障下仍然给出正确、可验证的设计。

---

[上一章：Prisma 与 PostgreSQL 的边界](10-prisma-and-postgresql-boundary.md) · [返回模块目录](README.md) · [返回教程首页](../README.md)
