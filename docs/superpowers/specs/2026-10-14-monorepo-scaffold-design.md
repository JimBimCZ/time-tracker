# Monorepo + Docker Compose scaffold — design

**Date:** 2026-10-14
**Scope:** a skeleton only. No business features, outbox, consumers or tables.

## Goal

A runnable skeleton of the architecture in `CLAUDE.md`:
- Every service boots and reports its own Postgres and Kafka connectivity.
- Kong routes to every service.
- One command starts the infrastructure, and one command starts the apps.

## Dev loop

- **Infrastructure in Docker Compose:** Kafka, 4× Postgres, Redis, Kong.
- **Services and web app on the host** via `pnpm dev`, with hot reload.
- Kong reaches the host services through `host.docker.internal`.
- Each service has a Dockerfile for the later Kubernetes step. Compose does not use them.

## Layout

```
apps/web/                         React + Vite
services/auth/                    NestJS
services/catalog/                 NestJS
services/tracking/                NestJS
services/reporting/               NestJS
packages/contracts/               zod event envelope schema + inferred TS type
infra/kong/kong.yml               Kong declarative config (DB-less)
docker-compose.yml                infrastructure only
pnpm-workspace.yaml               apps/*, services/*, packages/*
services/*/.env.example           per-service PORT, DATABASE_URL, KAFKA_BROKERS (each service loads its own .env via process.loadEnvFile; names collide, so no root .env)
.gitignore
```

`packages/contracts` contains only the envelope: `event_id` (uuid), `type`, `schema_version` (int), `occurred_at` (ISO datetime), `user_id` (uuid) and `payload`. Per-event schemas are added later, together with the features that use them.

## Ports

| Component | Host port |
|---|---|
| auth / catalog / tracking / reporting | 3001 / 3002 / 3003 / 3004 |
| web (Vite) | 5173 |
| Kong proxy | 8000 |
| Kong admin API (read-only use; DB-less mode) | 8001 |
| Postgres auth / catalog / tracking / reporting | 5433 / 5434 / 5435 / 5436 |
| Redis | 6379 |
| Kafka (host listener) | 9092 |

Postgres starts at 5433 so it doesn't collide with a Postgres already running locally on 5432. Every published port is bound to `127.0.0.1` only. Dev credentials live in Compose and the `.env.example` files, and none are exposed beyond localhost.

## Services

Each NestJS service:
- Reads `PORT`, `DATABASE_URL` and `KAFKA_BROKERS` from env, with validation. It fails fast if any is missing.
- Has a Drizzle client connected to its own database. There is no schema yet.
- Exposes `GET /health`, which:
  - runs `SELECT 1` on its own database;
  - connects a kafkajs admin client, lists topics, then disconnects;
  - returns `200 {db:"ok",kafka:"ok"}`, or `503` with whichever check failed.
- Has a multi-stage `Dockerfile`, based on Debian slim rather than Alpine, because of the native `argon2` package later.

## Kong routing

Each route matches a service-name prefix with `strip_path: true`:

| Route | Upstream |
|---|---|
| `/auth/*` | `host.docker.internal:3001` |
| `/catalog/*` | `host.docker.internal:3002` |
| `/tracking/*` | `host.docker.internal:3003` |
| `/reporting/*` | `host.docker.internal:3004` |

- **Change from CLAUDE.md:** tracking's routes become `/tracking/timer…` and `/tracking/entries…` instead of `/timer` and `/entries`. With one prefix per service, every route can strip the same way and Kong config never needs per-endpoint entries. CLAUDE.md and the diagram are updated to match.
- **Rate limiting:** the global `rate-limiting` plugin uses `policy: redis` and allows 100 requests per minute per IP, a dev default.
- **JWT:** not enabled in this step. It arrives with the auth service.

## Kafka

- A single broker in KRaft mode (no ZooKeeper), with one listener for containers and one for the host.
- A one-shot `kafka-init` container (Compose profile `init`, run by `docker compose run --rm kafka-init`, idempotent via `--if-not-exists`) creates the topics:
  - `user.events`, `catalog.events`, `timer.commands`, `timer.commands.dlq`, `tracking.events`
  - 6 partitions each, replication factor 1. The partition key is `user_id`.

## Root scripts

| Script | Does |
|---|---|
| `pnpm infra:up` / `pnpm infra:down` | `docker compose up -d --wait && docker compose run --rm kafka-init` / `docker compose down` |
| `pnpm dev` | runs every service and the web app in parallel (`pnpm -r --parallel dev`) |
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm lint` | one root ESLint flat config over the whole repo |

## Versions

Every dependency and image is pinned to an exact version: the newest stable release published at least two weeks earlier, i.e. before 2026-09-30, as checked against the npm registry and Docker Hub. TypeScript is 6.0.3, not 7.x, because `typescript-eslint` 8.71 supports TypeScript `<6.1`.

## Done when

1. `pnpm install && pnpm infra:up` exits 0, every long-running container is healthy, and `kafka-init` exits 0.
2. `pnpm dev` starts 4 services and the web app without errors.
3. `curl -s localhost:8000/{auth,catalog,tracking,reporting}/health` → each returns `200 {"db":"ok","kafka":"ok"}`.
4. Stopping one Postgres container makes that service's health return `503`.
5. `kafka-topics --list` shows the 5 topics.
6. `localhost:5173` renders the web app.
7. `pnpm typecheck` and `pnpm lint` pass.

No unit tests; there is no critical logic in this step.

## Out of scope

Outbox, consumers, event-specific schemas, DB tables, auth/JWT, UI features, Kubernetes.
