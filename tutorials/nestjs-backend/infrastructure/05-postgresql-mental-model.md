# PostgreSQL 运行架构：Cluster、进程、内存、WAL 与 MVCC

> [返回本模块目录](README.md)

## 1. 术语层级

```text
PostgreSQL Server/Instance
└─ Database Cluster（一个 data directory）
   ├─ Database: scaffold
   │  ├─ Schema: public
   │  │  ├─ Table
   │  │  ├─ Index
   │  │  ├─ View/Function/Type
   │  └─ Other schemas
   └─ Database: postgres
```

这里的 Cluster 不是“多机集群”，而是一套由一个 Server 管理的数据目录和多个 Database。

跨 Database 查询不像跨 Schema 那样直接。一个应用通常连接明确 Database，再用 Schema 组织对象。

## 2. 连接到什么

```text
postgresql://user:password@host:port/database?schema=public
```

- Host/Port 找 Server；
- User 决定身份/权限；
- Database 决定连接范围；
- Prisma 的 schema 参数影响对象 Schema。

连接不是普通无成本函数调用；PostgreSQL 通常每连接一个 Backend Process。

## 3. 进程模型

主要进程概念：

- Postmaster/Main Server：监听连接、管理子进程；
- Backend Process：每客户端连接；
- Checkpointer；
- Background Writer；
- WAL Writer；
- Autovacuum Launcher/Worker；
- Replication/WAL Sender 等。

查看：

```sql
SELECT pid, usename, datname, state, wait_event_type, wait_event, query
FROM pg_stat_activity;
```

这解释了为什么 1000 个应用连接很昂贵，以及为什么需要 Pool。

## 4. 存储单位

Table/Index 被存为 Relation File，内部按 Page（默认通常 8KB）管理。Page 中存 Tuple/Index Entry。

查询成本常讨论：

- 读取多少 Page；
- Page 是否在 Shared Buffer/OS Cache；
- 随机还是顺序 I/O；
- 返回多少 Tuple；
- 是否需要 Sort/Hash 临时空间。

## 5. Shared Buffers 与 OS Cache

PostgreSQL 有 Shared Buffer Cache，OS 也有 Page Cache。`EXPLAIN ... BUFFERS` 的 Hit 表示 PostgreSQL Buffer 命中，不等于数据永远在物理内存。

不要把数据库 Cache 与 Redis 混淆：数据库 Cache 加速 Page，但仍执行 Query/Visibility/权限；Redis 是应用语义缓存并带一致性问题。

## 6. WAL

Write-Ahead Log 原则：数据 Page 写磁盘前，描述修改的 WAL 必须先持久化。

用途：

- Crash Recovery；
- Replication；
- Point-in-time Recovery；
- Logical Decoding（不同机制/配置）。

事务 Commit 通常等待相关 WAL 达到持久化要求，而不是每次立刻把所有 Table Page 写完。

## 7. Checkpoint

Checkpoint 把脏 Page 推向持久存储并建立恢复起点。过于频繁会产生 I/O 尖峰；太少则恢复 WAL 更长、WAL 空间更大。由数据库运维根据负载配置。

应用开发需要知道：大批量写入会产生 WAL、影响 Replica Lag 和备份，不是只有 Table Size。

## 8. Crash Recovery

PostgreSQL 重启时使用 WAL 重放已提交修改，撤销/忽略未提交事务效果。它保证数据库自身原子持久性，但不能撤销已经发送的 Email/HTTP，因此需要 Outbox 和幂等。

## 9. MVCC 初步

PostgreSQL 更新通常创建新 Row Version，不直接覆盖旧版本。不同 Transaction 根据 Snapshot 看到不同版本。

好处：读写并发更好，普通 Reader 不必阻塞 Writer。

代价：旧版本要由 VACUUM 清理；长事务会阻止清理，产生 Bloat。

Row 内部有类似创建/删除事务可见性元数据（概念上的 xmin/xmax）。不要依赖内部字段作为业务版本。

## 10. System Catalog

Schema、Column、Index、Constraint 都记录在系统 Catalog。`
\d`、Information Schema 和 `pg_catalog` 查询这些元数据。

常用：

```sql
\l
\dn
\dt
\d projects
\di
```

## 11. Data Directory 与 Docker Volume

官方 PostgreSQL Container 把数据放 `/var/lib/postgresql/data`，当前 Compose Mount Named Volume。不要直接编辑 Data File；使用 SQL、备份/恢复和官方工具。

PostgreSQL Major Version 的 Data Format 可能不同，升级不是换 Image Tag 后直接复用旧目录这么简单，需要 pg_upgrade、逻辑迁移或托管升级流程。

## 12. psql 基础实验

```bash
docker compose exec postgres psql -U scaffold -d scaffold
```

```sql
SELECT version();
SELECT current_database(), current_user, current_schema();
SHOW data_directory;
SHOW shared_buffers;
SHOW transaction_isolation;
SELECT pg_size_pretty(pg_database_size(current_database()));
```

## 13. 验收问题

1. Cluster 与 Database 有何区别？
2. 为什么每连接成本高？
3. WAL 为什么先于 Data Page？
4. Commit 后 Page 是否一定已经写进 Table File？
5. MVCC 为什么需要 VACUUM？
6. 长事务为什么会造成 Bloat？
7. Docker Image Major Version 升级为何需专门计划？

---

[上一章：容器运行、安全与排障](04-docker-runtime-debug-security.md) · [返回模块目录](README.md) · [下一章：关系建模与 SQL](06-postgresql-schema-and-sql.md)
