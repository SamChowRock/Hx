# 模块 02｜前端研发转后端：核心思维

> [返回教程首页](../README.md)

这个模块被拆成 4 册。建议按顺序阅读，但每次只读一册。

1. [学习目标、最小后端知识与学习方法](02-01-learning-path.md)
2. [后端权威性、信任边界与状态归属](02-02-authority-trust-state.md)
3. [并发、网络失败、一致性与不变量](02-03-concurrency-failure-consistency.md)
4. [API 契约、安全、可运维性与多实例](02-04-contract-security-operations.md)

读完后，你应能解释：

- 为什么前端校验不能替代服务端校验；
- 为什么 Node.js 单线程不代表没有业务并发；
- 为什么网络超时后不能盲目重试写请求；
- 哪些状态放 PostgreSQL、Redis、Object Storage 或进程内存；
- 哪些结果必须强一致，哪些适合最终一致；
- 一个后端功能除了 Endpoint 还需要设计什么。
