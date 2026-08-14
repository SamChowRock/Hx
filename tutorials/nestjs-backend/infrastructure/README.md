# Docker 与 PostgreSQL 深度模块

> [返回教程首页](../README.md)

这个模块补齐应用代码之外的两项核心能力：理解服务如何在容器中运行，以及数据如何在 PostgreSQL 中被存储、并发修改、恢复和运维。

## Docker 路线

1. [Docker 运行模型：镜像、容器、进程与文件系统](01-docker-mental-model.md)
2. [Dockerfile：构建上下文、Layer、缓存与多阶段构建](02-dockerfile-build.md)
3. [Compose：服务发现、网络、端口、Volume 与健康检查](03-compose-network-storage.md)
4. [容器运行、安全、优雅关闭与故障排查](04-docker-runtime-debug-security.md)

## PostgreSQL 路线

5. [PostgreSQL 运行架构：Cluster、进程、内存、WAL 与 MVCC](05-postgresql-mental-model.md)
6. [关系建模与 SQL：类型、约束、Join、聚合和窗口函数](06-postgresql-schema-and-sql.md)
7. [索引、统计信息与查询计划](07-postgresql-indexes-and-query-plans.md)
8. [事务、隔离、锁、死锁、VACUUM 与 Bloat](08-postgresql-mvcc-transactions-locks.md)
9. [连接池、监控、备份、PITR、复制与恢复](09-postgresql-operations-and-recovery.md)
10. [Prisma 与 PostgreSQL 的边界](10-prisma-and-postgresql-boundary.md)

## 综合实验

11. [Docker + PostgreSQL 综合实验与故障演练](11-integrated-labs.md)

## 学习完成标准

完成后，你应能独立解释：

- Image、Container 与 VM 的区别；
- Docker Layer、Build Cache 和 Multi-stage 的意义；
- Compose 服务名为什么能当 Hostname；
- Volume 为什么决定数据库数据是否保留；
- 容器为什么要正确处理 SIGTERM 和 PID 1；
- PostgreSQL 的 Database、Schema、Table 和 Process 关系；
- WAL、MVCC、VACUUM 为什么存在；
- B-tree 组合索引为什么与查询顺序相关；
- 默认事务隔离会出现哪些并发问题；
- Connection Pool、备份、PITR 和 Read Replica 各解决什么；
- Prisma 帮了什么，又隐藏了哪些数据库事实。

每一册都包含基于当前项目的实验。只阅读不执行，不算完成。
