# 训练方法、实验环境和证据要求

> [返回专家训练目录](README.md)

## 1. 为什么“继续阅读”不会自动产生专家能力

后端专家真正做的是：

```text
面对不完整需求
→ 找出不变量和威胁
→ 设计数据与失败模型
→ 做出可解释的取舍
→ 用测试和观测证明
→ 在生产约束下发布
→ 从事故和数据中修正
```

阅读只能提供候选工具。你必须在有反馈的环境中使用它们。

## 2. 每个实验使用同一个六步闭环

### Step 1：先预测

运行代码前写下：

- 成功响应是什么；
- 数据库应出现哪些 Row；
- 并发两次会怎样；
- 进程在哪一步崩溃会留下什么；
- 重试是否安全；
- 哪些日志/指标能证明判断。

### Step 2：建立可失败的最小实现

不要先追求完美。实现最小版本，让它在测试中暴露：

- 重复数据；
- Lost Update；
- 越权；
- 部分提交；
- 无界请求；
- 不可恢复的 Worker 状态。

### Step 3：主动制造问题

例如：

```bash
# 并发发送 20 个请求
seq 1 20 | xargs -P 20 -I {} curl ...

# 暂停本地邮件 Provider
docker compose stop mailpit

# 观察数据库锁和活动
docker compose exec postgres psql -U scaffold -d scaffold
```

所有破坏性 SQL 只允许在专用本地/临时测试数据库运行。

### Step 4：收集证据

每次实验保存：

- 请求和状态码；
- 相关 Request ID；
- 结构化日志；
- SQL 查询结果；
- `EXPLAIN`；
- 测试输出；
- 修复前后指标；
- Git Diff。

### Step 5：修复并证明

“我加了事务”不是证明。你要再次运行原来的并发/故障实验，确认不变量成立。

### Step 6：写评审结论

回答：

1. Root Cause 是什么；
2. 为什么原设计在 Happy Path 看不出来；
3. 修复保护了哪个不变量；
4. 新增了什么成本；
5. 还有什么 Residual Risk；
6. 什么时候需要重新设计。

## 3. 建立安全实验环境

创建训练分支：

```bash
git switch -c codex/backend-expert-track
```

使用独立测试数据库，建议 URL 中明确包含 `expert_test`：

```text
postgresql://scaffold:scaffold@localhost:5432/expert_test?schema=public
```

不要让带 `TRUNCATE`、故障注入和批量数据生成的实验连接生产或共享开发数据库。

每个破坏性脚本都应先断言：

```text
NODE_ENV=test
数据库 Host 是 localhost/CI service
数据库名包含 test
没有生产 Secret
```

## 4. 建立学习日志

建议在不提交 Secret 的位置记录：

```markdown
# Lab: optimistic locking

## Prediction

两个 version=1 更新只能一个成功。

## Baseline failure

请求 A/B 都返回 200，最终 A 被覆盖。

## Evidence

- request ids
- SQL rows
- test output

## Change

增加 version + conditional update。

## Verification

一个 200，一个 409，数据库 version=2。

## Tradeoff

客户端需要刷新与冲突 UI。
```

## 5. 评审时禁止的答案

这些回答说明仍停留在“知道名词”：

- “因为这是最佳实践”；
- “大厂都这么做”；
- “用了事务就不会有并发问题”；
- “用了 JWT 就安全”；
- “用了 Redis 就快”；
- “测试通过，所以生产没问题”；
- “以后上微服务就解决了”；
- “前端不会传这个值”。

必须说明适用前提、失败模型、证据和代价。

## 6. 模块完成定义

- [ ] 基础概念能用当前项目代码解释；
- [ ] 完成 Mandatory Lab；
- [ ] 复现至少一个失败；
- [ ] 增加自动化回归测试；
- [ ] 完成一次同伴/自我设计评审；
- [ ] 写下替代方案；
- [ ] 没有把 Secret、测试垃圾或破坏性配置提交进仓库。
