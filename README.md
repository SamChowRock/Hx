# NestJS Production Scaffold

Milestone 0 provides a strict TypeScript NestJS API and Worker foundation with validated configuration, JSON logs, OpenAPI, health endpoints, Docker-based local dependencies, CI, and a non-root production image.

The project decisions that guide this scaffold are in `docs/REFERENCE_PRODUCT.md`, `docs/API_CONVENTIONS.md`, `docs/THREAT_MODEL.md`, and `docs/adr/`.

## Prerequisites

- Node.js 22.14.0 (see `.nvmrc`)
- pnpm 10.11.0
- Docker Desktop for local infrastructure

## Start locally

```bash
cp .env.example .env
pnpm install
docker compose up -d postgres redis-cache redis-queue minio mailpit
pnpm dev:api
```

Open `http://localhost:3000/docs` for OpenAPI and use these endpoints:

- `GET /api/health/live`
- `GET /api/health/ready`

Run the Worker separately with `pnpm dev:worker`.

## Verification

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Git hook

This workspace uses Husky for pre-commit formatting, linting, and type checks. `pnpm install` runs the `prepare` script and enables `.husky/pre-commit` in a Git repository. If Git is initialized after dependencies are installed, run `pnpm exec husky` once to enable the hook.

## Local service ports

| Service             | Address                                    |
| ------------------- | ------------------------------------------ |
| PostgreSQL          | `localhost:5432`                           |
| Cache Redis         | `localhost:6379`                           |
| BullMQ Redis        | `localhost:6380`                           |
| MinIO API / console | `localhost:9000` / `http://localhost:9001` |
| Mailpit SMTP / UI   | `localhost:1025` / `http://localhost:8025` |

The Worker does not process jobs yet. Redis, Prisma, BullMQ, object storage, authentication, and domain modules are introduced in later milestones.
