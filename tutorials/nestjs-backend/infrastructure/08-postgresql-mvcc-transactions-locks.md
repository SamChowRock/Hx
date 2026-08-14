# 事务、隔离、锁、死锁、VACUUM 与 Bloat

> [返回本模块目录](README.md)

## 1. MVCC 可见性

每个 Transaction 根据 Snapshot 判断 Row Version 是否可见。Update 产生新版本，旧版本保留给仍需看到它的 Snapshot。

Reader 通常不阻塞 Writer，但 DDL、显式锁、冲突更新仍可能阻塞。

## 2. Transaction 命令

```sql
BEGIN;
-- reads/writes
COMMIT;
```

异常可 `ROLLBACK`。Savepoint 允许局部回退：

```sql
SAVEPOINT before_step;
ROLLBACK TO before_step;
```

应用通常让 Prisma Transaction Callback 抛错以回滚。

## 3. PostgreSQL 隔离级别

- Read Committed（默认）：每条 Statement 新 Snapshot；
- Repeatable Read：事务 Snapshot 稳定，PostgreSQL 防部分异常；
- Serializable：尝试效果等价串行，可能 Abort 要 Retry；
- Read Uncommitted 在 PostgreSQL 实际按 Read Committed。

## 4. Read Committed 的后果

同一事务两次 SELECT 可能看到不同已提交值。先读再写仍会 Lost Update/业务竞态，需 Conditional Update 或 Lock。

## 5. Row Lock

```sql
SELECT * FROM projects WHERE id = $1 FOR UPDATE;
```

锁定目标 Row 供修改。其他冲突修改等待。锁持有到 Transaction 结束。

变体：`FOR NO KEY UPDATE`、`FOR SHARE`、`FOR KEY SHARE`，冲突矩阵不同。

## 6. Table Lock 与 DDL

ALTER TABLE/Index 等需要不同强度 Table Lock。即使 DDL 本身很快，也可能排在长事务后等待，再阻塞后续请求形成队列。

生产 Migration 应检查 Lock Timeout、Statement Timeout 和当前长事务。

## 7. Deadlock

```text
Tx A 持 Row1 等 Row2
Tx B 持 Row2 等 Row1
```

PostgreSQL 检测后终止一个。应用必须识别 Deadlock Error 并对整个事务有限重试。固定资源锁顺序减少发生。

## 8. Lock 观察

```sql
SELECT a.pid,
       a.state,
       a.wait_event_type,
       a.wait_event,
       pg_blocking_pids(a.pid) AS blockers,
       a.query
FROM pg_stat_activity AS a
WHERE a.datname = current_database();
```

长时间 `idle in transaction` 是严重信号。

## 9. VACUUM

VACUUM 标记旧 Row Version 空间可重用，更新 Visibility Map，并防 Transaction ID Wraparound。它通常不把普通 Table File 立即缩小。

Autovacuum 按变化阈值运行。高更新表可能需要单独调节。

## 10. VACUUM FULL

重写表并强锁，能归还磁盘但生产影响大。不是普通维护命令。多数情况依赖 Autovacuum、合适 Fillfactor/重建策略。

## 11. Bloat

大量 Update/Delete 产生 Dead Tuple。长 Transaction、失效 Replication Slot、Autovacuum 跟不上会造成 Bloat：

- Table/Index 变大；
- Cache 命中下降；
- 查询扫描更多 Page；
- Vacuum 更慢。

## 12. HOT Update

如果更新列不在 Index 且 Page 有空间，PostgreSQL 可能 Heap-Only Tuple，减少 Index 更新。过多 Index 会降低 HOT 机会。

## 13. Transaction ID Wraparound

PostgreSQL Transaction ID 有限，必须 Freeze 旧 Tuple。忽视 Autovacuum 可能导致数据库为保护数据停止写入。监控 Age 很重要。

## 14. Mandatory Lab A：Snapshot

两个 psql Session：

1. A Read Committed Begin/Select；
2. B Update/Commit；
3. A 再 Select；
4. Repeatable Read 重做；
5. 比较看到的值。

## 15. Mandatory Lab B：锁等待/死锁

用两个 Project 复现 Lock Wait 与 Deadlock，使用 `pg_blocking_pids` 找阻塞者。修复锁顺序并写有上限 Retry。

## 16. Mandatory Lab C：长事务与 Vacuum

在隔离测试库：

1. A 开长 Transaction 保持 Snapshot；
2. B 大量 Update/Delete；
3. 运行 Vacuum/观察 Dead Tuple；
4. 结束 A；
5. 再 Vacuum；
6. 比较统计/大小。

## 17. 乐观锁与悲观锁

- 乐观：Version Conditional Update；冲突少、等待少，客户端处理 409；
- 悲观：Row Lock；冲突期间等待，适合短事务、必须串行的热点资源；
- Serializable：数据库检测不可序列化结果并 Abort。

选择基于冲突概率、事务长度和业务体验。

## 18. 验收问题

1. MVCC 为什么读通常不阻塞写？
2. Read Committed 为什么仍可能 Lost Update？
3. Deadlock 与普通 Lock Wait 区别？
4. VACUUM 为什么通常不缩小文件？
5. 长事务如何阻止清理？
6. Index 为什么影响 HOT Update？
7. Serializable 为什么仍需 Retry？

---

[上一章：索引与查询计划](07-postgresql-indexes-and-query-plans.md) · [返回模块目录](README.md) · [下一章：生产运维与恢复](09-postgresql-operations-and-recovery.md)
