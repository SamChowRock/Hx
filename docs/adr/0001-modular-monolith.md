# ADR 0001: Start with a Modular Monolith

## Context

The project needs an API and background processing while remaining operable by one developer. Premature microservices would add deployment, service-authentication, data-consistency, tracing, and operational overhead before independent scaling or ownership exists.

## Decision

Use one TypeScript/NestJS codebase and one versioned image. Deploy API and Worker as separate process types. Keep feature modules independent through public application interfaces and typed events; do not allow modules to reach into another module's persistence layer.

## Alternatives considered

- Multiple microservices from the first release.
- One API process with in-request background work.
- A framework-free Node.js service.

## Consequences

The system has a simple initial deployment and shared development workflow. Module boundaries must be enforced so that future extraction remains possible. A separate service is justified only by independently demonstrated scaling, reliability, security, ownership, or runtime requirements.

## Reconsider when

A module has a proven independent scaling/reliability boundary or a separate release/ownership need that outweighs distributed-systems cost.

---

# ADR 0001：从模块化单体开始（中文版）

## 背景

项目既需要 API 和后台处理能力，又必须能由一名开发者独立运维。过早采用微服务，会在尚不存在独立扩缩容或独立所有权需求时，就引入部署、服务认证、数据一致性、链路追踪和运维开销。

## 决策

使用一个 TypeScript/NestJS 代码库和一个版本化镜像。将 API 与 Worker 作为不同进程类型部署。功能模块通过公开的应用接口和类型化事件保持独立；禁止模块直接访问其他模块的持久化层。

## 已考虑的替代方案

- 从第一个版本开始使用多个微服务。
- 使用单一 API 进程，并在请求内部执行后台工作。
- 使用不依赖框架的 Node.js 服务。

## 后果

系统初始部署简单，并共享一套开发工作流。必须强制执行模块边界，才能保留未来拆分能力。只有在独立扩缩容、可靠性、安全性、所有权或运行时需求得到实际证明时，才应拆分单独服务。

## 重新评估条件

某个模块已经具有经过证明的独立扩缩容/可靠性边界，或者独立发布/所有权需求的收益超过分布式系统成本。
