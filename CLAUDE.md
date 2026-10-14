# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Goal

A time tracker for freelancers and contractors. One user works for many companies, on many projects and tickets. The point of the app is the end of the month: the user needs to know which time goes on which invoice.

This is a system-design exercise. It is deliberately overbuilt as scalable microservices.

## Stack

- **Services:** TypeScript + NestJS. Kafka client is `kafkajs`.
- **Broker:** Kafka.
- **Databases:** PostgreSQL, a separate instance per service. ORM is Drizzle with drizzle-kit migrations. The one-running-timer rule is `uniqueIndex().on(user_id).where(sql\`stopped_at IS NULL AND deleted_at IS NULL\`)`.
- **Gateway:** Kong (routing, load balancing, JWT, rate limiting), backed by Redis for rate limiting.
- **Frontend:** React + Vite.
- **Repo:** monorepo using pnpm workspaces.
- **Runtime:** Docker Compose for development. Local Kubernetes (kind/k3d) later for the scaling exercise. The hourly batch becomes a CronJob there.

## Commands

- First run: `pnpm install && for s in services/*; do cp -n $s/.env.example $s/.env; done`
- Infra (Kafka, 4× Postgres, Redis, Kong): `pnpm infra:up` / `pnpm infra:down`. `infra:up` also creates the Kafka topics; it's safe to re-run.
- Run everything (4 services + web, hot reload): `pnpm dev`. One service: `pnpm --filter @tt/<name> dev`.
- Health through Kong: `curl localhost:8000/<auth|catalog|tracking|reporting>/health`
- Checks: `pnpm typecheck`, `pnpm lint`
- E2E smoke (boots infra, services and web; Chromium): `pnpm e2e`. First time: `pnpm --filter @tt/e2e exec playwright install chromium`.
- Ports: services 3001–3004 (auth, catalog, tracking, reporting) · web 5173 · Kong 8000 · Postgres 5433–5436 · Kafka 9092 · Redis 6379
- New dependencies: pin exact versions. pnpm fails install on unreviewed install scripts; decide each one in `allowBuilds` in `pnpm-workspace.yaml`.

## Architecture

Full diagram: `assets/system-design.md` (Mermaid).

```
UI
 │
API Gateway — routing, load balancing, rate limiting, JWT validation
 │
 ├── Auth service       → users DB (relational)
 ├── Catalog service    → companies / projects / tickets DB (relational)
 ├── Tracking service   → time entries DB (relational)
 └── Reporting service  → aggregated DB (hourly batch)
          ▲
          └── Message broker ◄── events from Auth + Catalog + Tracking
```

- **Gateway** validates the JWT and passes the user ID to the services. The services don't re-authenticate.
  - Routing: one prefix per service (`/auth`, `/catalog`, `/tracking`, `/reporting`). Kong strips the prefix before forwarding the request.
  - Auth signs JWTs with an asymmetric key (ES256). Kong's OSS `jwt` plugin verifies them with the public key, stored as a credential in Kong's declarative config. Kong never holds the private key.
  - Rotating keys means updating Kong's config: add the new public key, then remove the old one. Automatic JWKS fetching would need Kong Enterprise's OpenID Connect plugin.
  - Services must be reachable only through Kong, because they trust the `user_id` header. On Kubernetes, enforce this with NetworkPolicies.
- **Each service owns its own DB.** There are no cross-service foreign keys and no shared databases.
- **Catalog** publishes ticket/project/company lifecycle events. Tracking keeps a local copy of the valid IDs.
- **Start/stop tracking** is asynchronous: the UI calls the Tracking API, which publishes start/stop commands to the broker, and the Tracking worker consumes them.
  - Every event has a unique ID, and consumers ignore duplicates.
  - Events are partitioned by user ID so each user's events stay in order.
  - Only one timer per user can run at a time. A DB constraint enforces this.
  - The UI turns the start button into a stop button after a click, but the backend guards are what guarantee correctness.
- **Editing time entries** is a synchronous REST call to Tracking. Every edit or delete also publishes an event.
- **Reporting** consumes events and aggregates them every hour, upserting by entry ID so a re-sent entry isn't double-counted.
- **Dashboard**: tracked time grouped by month, filterable by company/project. The current month is read live from Tracking; past months come from Reporting.
- Time precision is hours, and timestamps are stored in UTC. The app tracks hours only, with no money or rates.
- **Months follow the user's timezone.** An entry that crosses a month boundary is split between the two months.
- **Every entry needs a ticket.** If the ticket doesn't exist, the UI offers to create it (catalog REST call) and then starts the timer.

## Data model

All IDs are UUIDs and all timestamps are UTC. Catalog entities are archived (`archived_at`), never hard-deleted.

**Auth:** `users(id, email UNIQUE, password_hash, timezone, created_at)`, `refresh_tokens(id, user_id, token_hash, expires_at, revoked_at)`, `outbox`. Publishes `user.changed` (timezone) and `user.deleted` events.
- Passwords are hashed with Argon2id (`argon2` npm package) at no less than the OWASP minimum: `m=19456 KiB, t=2, p=1`. bcrypt is not used.

**Catalog:** `companies(id, user_id, name, notes, archived_at, ...)`, `projects(id, user_id, company_id, name, notes, archived_at, ...)`, `tickets(id, user_id, project_id, title, external_ref, notes, archived_at, ...)`, `outbox`.

**Tracking:**
- `tickets_local(ticket_id, project_id, company_id, user_id, archived)` is built from catalog events.
- `time_entries(id, user_id, ticket_id, project_id, company_id, started_at, stopped_at NULL, deleted_at, updated_at)` has `CHECK (stopped_at > started_at)` and `UNIQUE (user_id) WHERE stopped_at IS NULL AND deleted_at IS NULL`.
- `processed_events(event_id)` handles deduplication. There is also an `outbox`.
- The live view takes a `from`/`to` range that the UI computes in the user's timezone. Entries that cross the range edges are clipped to it.

**Reporting:**
- Name tables for companies, projects and tickets, plus `users(id, timezone)`, are all built from events.
- `entries(entry_id PK, user_id, ticket_id, project_id, company_id, started_at, stopped_at, deleted)` is upserted by entry ID.
- `monthly_totals(PK user_id, month, company_id, project_id, ticket_id; total_seconds, computed_at)` is rebuilt from `entries` by the hourly batch, splitting entries at month boundaries in the user's timezone.
- `processed_events(event_id)`.

## Events

**Envelope** (every message): `event_id, type, schema_version, occurred_at, user_id, payload`. The partition key is `user_id` on every topic.

| Topic | Type | Payload | Producer → Consumers |
|---|---|---|---|
| `user.events` | `user.changed` | `timezone` | Auth → Reporting |
| | `user.deleted` | — | Auth → Catalog, Tracking, Reporting |
| `catalog.events` | `company.changed` | `company_id, name, archived_at` | Catalog → Reporting |
| | `project.changed` | `project_id, company_id, name, archived_at` | Catalog → Reporting |
| | `ticket.changed` | `ticket_id, project_id, company_id, title, external_ref, archived_at` | Catalog → Tracking, Reporting |
| `timer.commands` | `timer.start` | `ticket_id` | Tracking API → Tracking worker |
| | `timer.stop` | — | Tracking API → Tracking worker |
| `tracking.events` | `entry.changed` | full entry: `entry_id, ticket_id, project_id, company_id, started_at, stopped_at, deleted` | Tracking → Reporting |

- **`*.changed` events carry the full current state.** Consumers upsert it, so there are no separate created/updated/archived events and no partial patches.
- **`user.deleted`:** every consumer hard-deletes all of its rows for that `user_id` and emits no further events, because each service cleans up its own data. Auth deletes the user and its tokens.
- **Archiving cascades in Catalog.** Archiving a company or project archives its tickets and sends a `ticket.changed` event for each one.
- **Tickets never move to another project.** Tracking and Reporting rely on this when they copy `project_id`/`company_id` onto entries.
- **Timer commands:** the UI sends `POST /tracking/timer/start|stop` with a UUID it generates, and that UUID becomes the `event_id`. Tracking publishes the command and returns `202`. `occurred_at` is the click time.
- **Starting while another timer runs:** the worker stops the running timer (`stopped_at` = the new start time) and starts the new one in the same transaction. It emits `entry.changed` for both entries.
- **UI feedback:** after a `202`, the UI polls `GET /tracking/timer/current` until the timer's state matches, or gives up after about 30 s. The UI shows a running clock computed from the BE `started_at`. The clock is display-only; the BE stays the source of truth.
- **Unknown ticket on `timer.start`:** the worker retries with backoff for about 30 s, then sends the command to `timer.commands.dlq`.
- **Recalculation window:** the hourly batch only recalculates the current and previous month. Older months are frozen.

**Contracts:** event schemas live in `packages/contracts` (zod, one schema per `type` + `schema_version`). It is the only code shared between services; no domain code is shared.
- Only backward-compatible changes are allowed: adding optional fields is fine; removing or renaming fields or changing a field's type is not. CI checks this against the previous schema.
- A breaking change gets a new `schema_version`, and the producer emits both versions until every consumer has migrated.
- Consumers are tolerant readers: they parse only the fields they use and ignore unknown ones.

**Topic ownership:** each topic has exactly one producing service, as in the table above. Each consuming service uses its own consumer group (`<service>-<purpose>`).

**Outbox pattern:** every service that publishes events writes the change and the event in one transaction, and a separate worker publishes them.

**Critical logic, which gets tests:** splitting entries at month and timezone boundaries, and the monthly totals.

## Workflow

- **Process:** use the superpowers skills: `brainstorming` before new features, `writing-plans` before multi-step work, then `subagent-driven-development` / `executing-plans`. Use `systematic-debugging` for bugs and `verification-before-completion` before claiming anything is done.
- **Implementation:** follow `ponytail` (minimal code; stdlib/native first).
- **Parallel agents:** allowed, but every agent must own a disjoint set of files or packages. Split work by service or package, never two agents in the same file. Use `isolation: "worktree"` when their work could overlap.
- **After each plan step:** run the `reviewer` agent with `model: "sonnet"` on that step's diff.
- **Before merging a branch:** run the `reviewer` agent with `model: "opus"` on the full branch diff.
- **Before every `git push`:** run `/security-review` on the pending changes. Fix or explicitly acknowledge every finding before pushing.
  - Then record it: `git rev-parse HEAD > "$(git rev-parse --git-dir)/security-review-ok"`.
  - The hook in `.claude/hooks/require-security-review.sh` blocks any push whose HEAD isn't recorded. A new commit invalidates the recording.

## Known gaps

- Services listen on all interfaces (app.listen(PORT)), so ports 3001–3004 bypass Kong. Fix in the JWT/user_id step: bind via a HOST env var (127.0.0.1 on the host; 0.0.0.0 in containers).
- packages/contracts is consumed from dist/ but nothing builds it. Fix in the first step that depends on @tt/contracts: build it before dev/typecheck, and use --filter @tt/<svc>... in Dockerfiles.
- `requestTimeout: 2000` is set on each service's shared kafkajs client so `/health` can't hang. Fix in the first step that adds producers/consumers: give health its own client or admin config, so group joins and large produces aren't cut off at 2 s.

## Rules for agents

- **No guessing.** If something is unknown, look it up in the code or docs, or ask. Don't invent APIs, file paths or requirements.
- **Prove it before claiming it.** Back every claim ("this works", "this is the cause", "this is fixed") with evidence: command output, a reproduction or a file reference.
- **No unit tests unless critical.** Write tests only for logic where a bug costs money or data, such as time totals, rounding and invoice aggregation.
- **Keep docs current, in the same change.** Any decision that contradicts or extends CLAUDE.md must update CLAUDE.md. Any decision that affects the architecture must update `assets/system-design.md` (the Mermaid source and the "Key flows" section) and re-render `assets/system-design.png`.
- **Brevity.** Keep code, comments and responses short. Don't add unrequested abstractions or features.
