# Reference Product and Service Targets

The scaffold is validated against a multi-tenant B2B project/work-management SaaS. Organizations contain members, projects, files, notifications, exports, and third-party webhook integrations.

## Initial service targets

| Target                   | Initial value                                       |
| ------------------------ | --------------------------------------------------- |
| Deployment region        | One region                                          |
| Expected scale           | Hundreds to low thousands of active users           |
| API availability SLO     | 99.9% per month                                     |
| API latency SLO          | p95 reads under 300 ms; p95 writes under 700 ms     |
| Recovery time objective  | 4 hours                                             |
| Recovery point objective | 15 minutes                                          |
| Data classes             | Public, internal, personal, sensitive               |
| Operating model          | Managed services within a documented monthly budget |

These values are planning assumptions, not promises. Revisit them with actual traffic, incident, and cost data before adding scale-oriented infrastructure.

---

# 参考产品与服务目标（中文版）

本脚手架以一个多租户 B2B 项目/工作管理 SaaS 作为验证对象。组织中包含成员、项目、文件、通知、导出功能和第三方 Webhook 集成。

## 初始服务目标

| 目标             | 初始值                                     |
| ---------------- | ------------------------------------------ |
| 部署区域         | 单一区域                                   |
| 预期规模         | 数百至数千名活跃用户                       |
| API 可用性 SLO   | 每月 99.9%                                 |
| API 延迟 SLO     | 读取 p95 低于 300 ms；写入 p95 低于 700 ms |
| 恢复时间目标 RTO | 4 小时                                     |
| 恢复点目标 RPO   | 15 分钟                                    |
| 数据分类         | 公开、内部、个人、敏感                     |
| 运营模式         | 在有记录的月度预算内优先使用托管服务       |

这些数值是规划假设，而不是承诺。在增加面向扩展性的基础设施之前，应结合真实流量、事故和成本数据重新评估。
