# {{PROJECT_NAME}}

A production-oriented NestJS modular-monolith with separate API and Worker processes.

## Prerequisites

- Node.js 24.19.0
- pnpm 11.21.0
- Docker Desktop or Docker CLI with Compose

## Start locally

```bash
git init
pnpm install
cp .env.example .env
docker compose up --build -d
```

Open `http://localhost:3000/docs` for OpenAPI and `http://localhost:8025` for Mailpit.

## Verify

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose config --quiet
```
