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
