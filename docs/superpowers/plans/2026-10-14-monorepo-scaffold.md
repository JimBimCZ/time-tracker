# Monorepo + Docker Compose Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable skeleton: a pnpm monorepo with 4 NestJS services, each with a `/health` that checks its own Postgres and Kafka, a React+Vite app, `packages/contracts`, and Docker Compose infrastructure (Kafka, 4× Postgres, Redis, Kong) routing to the services.

**Architecture:** The infrastructure runs in Compose. Services and the web app run on the host with hot reload, and Kong reaches them via `host.docker.internal`. Each service holds module-level `pg` Pool, Drizzle and kafkajs singletons, plus one `HealthController`. The four services are deliberately identical copies; they share no code (CLAUDE.md: only `packages/contracts` is shared).

**Tech Stack:** pnpm 12.8.1 workspaces, Node 24, TypeScript 6.0.3, NestJS 12.1.1, Drizzle 0.45.3 + pg 8.23.0, kafkajs 2.2.4, zod 4.6.5, React 19.3.0 + Vite 8.3.1, ESLint 10.11.0 + typescript-eslint 8.71.0, apache/kafka 4.3.1, postgres 18.6-alpine, kong 3.9.2, redis 8.10.2-alpine.

**Spec:** `docs/superpowers/specs/2026-10-14-monorepo-scaffold-design.md`

## Global Constraints

- Every dependency is pinned to an **exact** version (no `^`/`~`) from the table below. Don't upgrade.
- npm: `@nestjs/{common,core,platform-express}` 12.1.1, `@nestjs/cli` 12.0.8, `reflect-metadata` 0.2.2, `rxjs` 7.8.2, `drizzle-orm` 0.45.3, `pg` 8.23.0, `@types/pg` 8.23.1, `kafkajs` 2.2.4, `zod` 4.6.5, `typescript` 6.0.3, `@types/node` 24.19.0, `eslint` 10.11.0, `@eslint/js` 10.0.1, `typescript-eslint` 8.71.0, `react`/`react-dom`/`@types/react`/`@types/react-dom` 19.3.0, `vite` 8.3.1, `@vitejs/plugin-react` 6.1.1.
- Images: `apache/kafka:4.3.1`, `postgres:18.6-alpine`, `kong:3.9.2`, `redis:8.10.2-alpine`, `node:24.20.0-bookworm-slim`.
- Ports: services 3001–3004 (auth, catalog, tracking, reporting); web 5173; Kong 8000 (proxy) and 8001 (admin); Postgres 5433–5436 (same order); Redis 6379; Kafka 9092. Every published port is bound to `127.0.0.1`.
- Kong routes `/auth`, `/catalog`, `/tracking`, `/reporting` use `strip_path: true`.
- Topics: `user.events`, `catalog.events`, `timer.commands`, `timer.commands.dlq` and `tracking.events`, each with 6 partitions and RF 1.
- **pnpm build scripts:** pnpm 12 fails install (`ERR_PNPM_IGNORED_BUILDS`) for any dependency with an unreviewed install script. For each package it names, add `<pkg>: false` under `allowBuilds:` in `pnpm-workspace.yaml`, unless the package is unusable without its script. If it is unusable without it, set `true` and state why in the commit message.
- No unit tests: this step has no critical logic (CLAUDE.md rule).
- Follow CLAUDE.md "Workflow": after each task, the `reviewer` agent (`model: "sonnet"`) reviews that task's diff before the next task starts.

## Execution order

Sequential: Task 0 → 1 → 2 → 3 → 4 → 5 → 6. There are no parallel agents, because every task runs `pnpm install` and writes the shared `pnpm-lock.yaml`.

## File map

```
package.json, pnpm-workspace.yaml, tsconfig.base.json, eslint.config.mjs, .dockerignore   (Task 1)
packages/contracts/{package.json,tsconfig.json,src/index.ts}                               (Task 1)
docker-compose.yml, infra/kong/kong.yml                                                    (Task 2)
services/auth/{package.json,tsconfig.json,nest-cli.json,.env.example,Dockerfile}           (Task 3)
services/auth/src/{env.ts,db.ts,kafka.ts,health.controller.ts,app.module.ts,main.ts}       (Task 3)
services/{catalog,tracking,reporting}/**  — copies of auth                                 (Task 4)
apps/web/{package.json,tsconfig.json,vite.config.ts,index.html,src/main.tsx,src/App.tsx}   (Task 5)
CLAUDE.md (Commands section)                                                               (Task 6)
```

---

### Task 0: Branch

- [ ] **Step 1:** Create the work branch.

```bash
git checkout -b scaffold
```

---

### Task 1: Root workspace + contracts

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.mjs`, `.dockerignore`
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/src/index.ts`

**Interfaces:**
- Produces: `tsconfig.base.json` (every package extends it); root scripts `infra:up`, `infra:down`, `dev`, `typecheck` and `lint`; `@tt/contracts` exporting `envelopeSchema` (zod) and `type Envelope`.

- [ ] **Step 1: Root `package.json`**

```json
{
  "name": "time-tracker",
  "private": true,
  "packageManager": "pnpm@12.8.1",
  "engines": { "node": ">=24" },
  "scripts": {
    "infra:up": "docker compose up -d --wait && docker compose run --rm kafka-init",
    "infra:down": "docker compose down",
    "dev": "pnpm -r --parallel dev",
    "typecheck": "pnpm -r typecheck",
    "lint": "eslint ."
  },
  "devDependencies": {
    "@eslint/js": "10.0.1",
    "@types/node": "24.19.0",
    "eslint": "10.11.0",
    "typescript": "6.0.3",
    "typescript-eslint": "8.71.0"
  }
}
```

- [ ] **Step 2: `pnpm-workspace.yaml`**

```yaml
packages:
  - apps/*
  - services/*
  - packages/*
```

- [ ] **Step 3: `tsconfig.base.json`**

TS 6 defaults `types` to `[]`, so every package must list the types it needs.

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 4: `eslint.config.mjs`**

```js
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['**/dist/**', '**/node_modules/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
);
```

- [ ] **Step 5: `.dockerignore`**

```
**/node_modules
**/dist
**/.env
.git
```

- [ ] **Step 6: `packages/contracts/package.json`**

```json
{
  "name": "@tt/contracts",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "zod": "4.6.5" },
  "devDependencies": { "typescript": "6.0.3" }
}
```

- [ ] **Step 7: `packages/contracts/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist", "declaration": true, "types": [] },
  "include": ["src"]
}
```

- [ ] **Step 8: `packages/contracts/src/index.ts`**

```ts
import { z } from 'zod';

// Envelope carried by every Kafka message (CLAUDE.md "Events"). Per-type payload schemas come with their features.
export const envelopeSchema = z.object({
  event_id: z.uuid(),
  type: z.string().min(1),
  schema_version: z.number().int().positive(),
  occurred_at: z.iso.datetime(),
  user_id: z.uuid(),
  payload: z.unknown(),
});

export type Envelope = z.infer<typeof envelopeSchema>;
```

- [ ] **Step 9: Install, then handle build-script errors**

Run: `pnpm install`
Expected: exit 0. If it fails with `ERR_PNPM_IGNORED_BUILDS`, apply the Global Constraints rule (`allowBuilds:` in `pnpm-workspace.yaml`) and re-run until it exits 0.

- [ ] **Step 10: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm --filter @tt/contracts build && ls packages/contracts/dist`
Expected: exit 0; `index.js` and `index.d.ts` are listed.

- [ ] **Step 11: Commit** (the lockfile included)

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json eslint.config.mjs .dockerignore packages/contracts
git commit -m "Add pnpm workspace root and contracts package"
```

---

### Task 2: Docker Compose infrastructure + Kong

**Files:**
- Create: `docker-compose.yml`, `infra/kong/kong.yml`

**Interfaces:**
- Produces: Postgres at `postgres://<svc>:<svc>@localhost:<port>/<svc>` for svc ∈ {auth 5433, catalog 5434, tracking 5435, reporting 5436}; Kafka at `localhost:9092` (host) and `kafka:29092` (containers); Kong at `localhost:8000`.

- [ ] **Step 1: `docker-compose.yml`**

```yaml
x-pg-health: &pg-health
  interval: 5s
  timeout: 3s
  retries: 10

services:
  pg-auth:
    image: postgres:18.6-alpine
    environment: { POSTGRES_USER: auth, POSTGRES_PASSWORD: auth, POSTGRES_DB: auth }
    ports: ["127.0.0.1:5433:5432"]
    volumes: [pg-auth:/var/lib/postgresql]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U auth -d auth"], <<: *pg-health }

  pg-catalog:
    image: postgres:18.6-alpine
    environment: { POSTGRES_USER: catalog, POSTGRES_PASSWORD: catalog, POSTGRES_DB: catalog }
    ports: ["127.0.0.1:5434:5432"]
    volumes: [pg-catalog:/var/lib/postgresql]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U catalog -d catalog"], <<: *pg-health }

  pg-tracking:
    image: postgres:18.6-alpine
    environment: { POSTGRES_USER: tracking, POSTGRES_PASSWORD: tracking, POSTGRES_DB: tracking }
    ports: ["127.0.0.1:5435:5432"]
    volumes: [pg-tracking:/var/lib/postgresql]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U tracking -d tracking"], <<: *pg-health }

  pg-reporting:
    image: postgres:18.6-alpine
    environment: { POSTGRES_USER: reporting, POSTGRES_PASSWORD: reporting, POSTGRES_DB: reporting }
    ports: ["127.0.0.1:5436:5432"]
    volumes: [pg-reporting:/var/lib/postgresql]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U reporting -d reporting"], <<: *pg-health }

  redis:
    image: redis:8.10.2-alpine
    ports: ["127.0.0.1:6379:6379"]
    healthcheck: { test: ["CMD", "redis-cli", "ping"], interval: 5s, timeout: 3s, retries: 10 }

  kafka:
    image: apache/kafka:4.3.1
    ports: ["127.0.0.1:9092:9092"]
    environment:
      KAFKA_NODE_ID: 1
      KAFKA_PROCESS_ROLES: broker,controller
      KAFKA_LISTENERS: INTERNAL://:29092,EXTERNAL://:9092,CONTROLLER://:9093
      KAFKA_ADVERTISED_LISTENERS: INTERNAL://kafka:29092,EXTERNAL://localhost:9092
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: INTERNAL:PLAINTEXT,EXTERNAL:PLAINTEXT,CONTROLLER:PLAINTEXT
      KAFKA_INTER_BROKER_LISTENER_NAME: INTERNAL
      KAFKA_CONTROLLER_LISTENER_NAMES: CONTROLLER
      KAFKA_CONTROLLER_QUORUM_VOTERS: 1@kafka:9093
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: 1
      KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: 1
      KAFKA_AUTO_CREATE_TOPICS_ENABLE: "false"
      KAFKA_NUM_PARTITIONS: 6
    healthcheck:
      test: ["CMD-SHELL", "/opt/kafka/bin/kafka-broker-api-versions.sh --bootstrap-server localhost:9092 > /dev/null 2>&1"]
      interval: 10s
      timeout: 10s
      retries: 12
      start_period: 20s

  # One-shot; run by `pnpm infra:up`. The profile keeps it out of `up --wait`.
  kafka-init:
    image: apache/kafka:4.3.1
    profiles: [init]
    depends_on: { kafka: { condition: service_healthy } }
    entrypoint: ["/bin/sh", "-c"]
    command:
      - |
        for t in user.events catalog.events timer.commands timer.commands.dlq tracking.events; do
          /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:29092 --create --if-not-exists --topic "$$t" --partitions 6 --replication-factor 1 || exit 1
        done

  kong:
    image: kong:3.9.2
    depends_on: { redis: { condition: service_healthy } }
    environment:
      KONG_DATABASE: "off"
      KONG_DECLARATIVE_CONFIG: /kong/kong.yml
      KONG_PROXY_LISTEN: 0.0.0.0:8000
      KONG_ADMIN_LISTEN: 0.0.0.0:8001
      KONG_PROXY_ACCESS_LOG: /dev/stdout
      KONG_PROXY_ERROR_LOG: /dev/stderr
    volumes: ["./infra/kong/kong.yml:/kong/kong.yml:ro"]
    ports: ["127.0.0.1:8000:8000", "127.0.0.1:8001:8001"]
    extra_hosts: ["host.docker.internal:host-gateway"]
    healthcheck: { test: ["CMD", "kong", "health"], interval: 5s, timeout: 5s, retries: 10 }

volumes:
  pg-auth:
  pg-catalog:
  pg-tracking:
  pg-reporting:
```

Kafka has no volume because dev data is disposable. `kafka-init` is idempotent, so topics come back on every `infra:up`.

- [ ] **Step 2: `infra/kong/kong.yml`**

This config shape (including the nested `redis:` block) was validated with `kong config parse` on `kong:3.9.2`.

```yaml
_format_version: "3.0"

services:
  - name: auth
    url: http://host.docker.internal:3001
    routes: [{ name: auth, paths: [/auth], strip_path: true }]
  - name: catalog
    url: http://host.docker.internal:3002
    routes: [{ name: catalog, paths: [/catalog], strip_path: true }]
  - name: tracking
    url: http://host.docker.internal:3003
    routes: [{ name: tracking, paths: [/tracking], strip_path: true }]
  - name: reporting
    url: http://host.docker.internal:3004
    routes: [{ name: reporting, paths: [/reporting], strip_path: true }]

plugins:
  - name: rate-limiting
    config:
      minute: 100
      limit_by: ip
      policy: redis
      redis:
        host: redis
        port: 6379
```

- [ ] **Step 3: Validate the Kong config**

Run: `docker run --rm -v "$PWD/infra/kong/kong.yml:/kong.yml:ro" -e KONG_DATABASE=off kong:3.9.2 kong config parse /kong.yml`
Expected: `parse successful`

- [ ] **Step 4: Bring the infrastructure up**

Run: `pnpm infra:up`
Expected: exit 0. Then `docker compose ps` shows the 4 Postgres containers, redis, kafka and kong as `healthy`.

- [ ] **Step 5: Verify topics**

Run: `docker compose exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --describe | grep -E '^Topic:' | awk '{print $2, $6}'`
Expected: exactly these 5 lines (in any order): `user.events 6`, `catalog.events 6`, `timer.commands 6`, `timer.commands.dlq 6`, `tracking.events 6`.

- [ ] **Step 6: Verify the Kong route and the rate-limit headers** (no service is up yet, so 502 is expected)

Run: `curl -si localhost:8000/auth/health | grep -iE '^HTTP|ratelimit-limit'`
Expected: `HTTP/1.1 502 Bad Gateway` and a `RateLimit-Limit: 100` header.

- [ ] **Step 7: Verify idempotency**

Run: `pnpm infra:up`
Expected: exit 0 again, with no "topic already exists" failures.

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml infra/kong/kong.yml
git commit -m "Add Compose infrastructure: Kafka, Postgres x4, Redis, Kong"
```

---

### Task 3: Auth service skeleton

**Files:**
- Create: `services/auth/package.json`, `services/auth/tsconfig.json`, `services/auth/nest-cli.json`, `services/auth/.env.example`, `services/auth/Dockerfile`
- Create: `services/auth/src/env.ts`, `db.ts`, `kafka.ts`, `health.controller.ts`, `app.module.ts`, `main.ts`

**Interfaces:**
- Consumes: the Task 2 infrastructure (Postgres 5433, Kafka 9092, Kong route `/auth`).
- Produces: `GET /health` → `200 {"db":"ok","kafka":"ok"}`, or `503` with the same keys, where a failing check reads `"down"`. Task 4 copies this service exactly; only the name and port change.

- [ ] **Step 1: `services/auth/package.json`**

```json
{
  "name": "@tt/auth",
  "private": true,
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start": "node dist/main.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@nestjs/common": "12.1.1",
    "@nestjs/core": "12.1.1",
    "@nestjs/platform-express": "12.1.1",
    "drizzle-orm": "0.45.3",
    "kafkajs": "2.2.4",
    "pg": "8.23.0",
    "reflect-metadata": "0.2.2",
    "rxjs": "7.8.2",
    "zod": "4.6.5"
  },
  "devDependencies": {
    "@nestjs/cli": "12.0.8",
    "@types/node": "24.19.0",
    "@types/pg": "8.23.1",
    "typescript": "6.0.3"
  }
}
```

- [ ] **Step 2: `services/auth/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: `services/auth/nest-cli.json`**

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "sourceRoot": "src",
  "compilerOptions": { "deleteOutDir": true }
}
```

- [ ] **Step 4: `services/auth/.env.example`**

```
PORT=3001
DATABASE_URL=postgres://auth:auth@localhost:5433/auth
KAFKA_BROKERS=localhost:9092
```

Then run `cp services/auth/.env.example services/auth/.env`. `.env` is gitignored.

- [ ] **Step 5: `services/auth/src/env.ts`**

```ts
import { z } from 'zod';

// Local dev reads ./.env; containers pass real env vars, so a missing file is fine.
try {
  process.loadEnvFile();
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
}

export const env = z
  .object({
    PORT: z.coerce.number().int().positive(),
    DATABASE_URL: z.string().startsWith('postgres://'),
    KAFKA_BROKERS: z.string().min(1).transform((s) => s.split(',')),
  })
  .parse(process.env);
```

- [ ] **Step 6: `services/auth/src/db.ts`**

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from './env';

export const pool = new Pool({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 2000 });
// Idle-client errors (e.g. DB restart) would otherwise crash the process; queries still reject and /health reports "down".
pool.on('error', () => {});
export const db = drizzle(pool);
```

- [ ] **Step 7: `services/auth/src/kafka.ts`**

```ts
import { Kafka, logLevel } from 'kafkajs';
import { env } from './env';

export const kafka = new Kafka({ clientId: 'auth', brokers: env.KAFKA_BROKERS, logLevel: logLevel.WARN });
```

- [ ] **Step 8: `services/auth/src/health.controller.ts`**

```ts
import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { db } from './db';
import { kafka } from './kafka';

type Status = 'ok' | 'down';

async function check(fn: () => Promise<unknown>): Promise<Status> {
  try {
    await fn();
    return 'ok';
  } catch {
    return 'down';
  }
}

async function checkKafka() {
  // No retries: health must answer fast, not wait out kafkajs' default backoff.
  const admin = kafka.admin({ retry: { retries: 0 } });
  await admin.connect();
  try {
    await admin.listTopics();
  } finally {
    await admin.disconnect();
  }
}

@Controller('health')
export class HealthController {
  @Get()
  async health() {
    const [dbStatus, kafkaStatus] = await Promise.all([check(() => db.execute(sql`select 1`)), check(checkKafka)]);
    const body = { db: dbStatus, kafka: kafkaStatus };
    if (dbStatus !== 'ok' || kafkaStatus !== 'ok') throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    return body;
  }
}
```

- [ ] **Step 9: `services/auth/src/app.module.ts`**

```ts
import { Module, OnApplicationShutdown } from '@nestjs/common';
import { pool } from './db';
import { HealthController } from './health.controller';

@Module({ controllers: [HealthController] })
export class AppModule implements OnApplicationShutdown {
  async onApplicationShutdown() {
    await pool.end();
  }
}
```

- [ ] **Step 10: `services/auth/src/main.ts`**

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { env } from './env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(env.PORT);
}

void bootstrap();
```

- [ ] **Step 11: `services/auth/Dockerfile`** (build context = repo root)

```dockerfile
FROM node:24.20.0-bookworm-slim AS build
RUN npm install -g pnpm@12.8.1
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @tt/auth...
RUN pnpm --filter @tt/auth build
RUN pnpm --filter @tt/auth deploy --prod /out

FROM node:24.20.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/services/auth/dist ./dist
USER node
CMD ["node", "dist/main.js"]
```

If `pnpm deploy` fails with an error about non-injected workspace packages, add `--legacy` to that `deploy` line and note it in the commit message.

- [ ] **Step 12: Install and typecheck**

Run: `pnpm install && pnpm --filter @tt/auth typecheck && pnpm lint`
Expected: exit 0. Apply the `allowBuilds` rule if install fails.

- [ ] **Step 13: Run, then verify through Kong** (infrastructure from Task 2 is up)

Run, in the background: `pnpm --filter @tt/auth dev`. Wait for `Nest application successfully started`.
Run: `curl -s -w ' %{http_code}\n' localhost:8000/auth/health`
Expected: `{"db":"ok","kafka":"ok"} 200`

- [ ] **Step 14: Verify that the failure path returns 503**

Run: `docker compose stop pg-auth && curl -s -w ' %{http_code}\n' localhost:8000/auth/health; docker compose start pg-auth`
Expected: `{"db":"down","kafka":"ok"} 503` within about 3 s.

- [ ] **Step 15: Verify the Docker image builds and runs**

```bash
docker build -f services/auth/Dockerfile -t tt-auth .
docker run --rm -d --name tt-auth-check -p 127.0.0.1:3901:3001 \
  -e PORT=3001 -e DATABASE_URL=postgres://auth:auth@host.docker.internal:5433/auth -e KAFKA_BROKERS=host.docker.internal:9092 tt-auth
sleep 3; curl -s -w ' %{http_code}\n' localhost:3901/health; docker rm -f tt-auth-check
```

Expected: the build succeeds and curl prints a JSON body with `"db":"ok"`. Kafka may be `"down"` here, because the broker advertises `localhost:9092`, which doesn't resolve from inside a container. That's acceptable for this check, which only proves the image boots and serves HTTP. Containerized Kafka access gets solved in the Kubernetes step.

- [ ] **Step 16: Stop the dev process and commit**

```bash
git add services/auth pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "Add auth service skeleton with DB/Kafka health check"
```

---

### Task 4: Catalog, tracking and reporting services

These are copies of auth with only the name and port changed, deliberately (no shared code; see Architecture).

**Files:**
- Create: `services/{catalog,tracking,reporting}/**`, generated from `services/auth`

**Interfaces:**
- Consumes: `services/auth` from Task 3.
- Produces: `/health` on ports 3002, 3003 and 3004, reachable at `/catalog/health`, `/tracking/health` and `/reporting/health` through Kong.

- [ ] **Step 1: Generate the copies**

```bash
for pair in catalog:3002:5434 tracking:3003:5435 reporting:3004:5436; do
  IFS=: read -r name port pgport <<<"$pair"
  rsync -a --exclude node_modules --exclude dist --exclude .env services/auth/ "services/$name/"
  sed -i '' -e "s/@tt\/auth/@tt\/$name/g" -e "s#services/auth/#services/$name/#g" "services/$name/package.json" "services/$name/Dockerfile"
  sed -i '' -e "s/clientId: 'auth'/clientId: '$name'/" "services/$name/src/kafka.ts"
  printf 'PORT=%s\nDATABASE_URL=postgres://%s:%s@localhost:%s/%s\nKAFKA_BROKERS=localhost:9092\n' "$port" "$name" "$name" "$pgport" "$name" > "services/$name/.env.example"
  cp "services/$name/.env.example" "services/$name/.env"
done
```

- [ ] **Step 2: Check that no `auth` references are left**

Run: `grep -rn "auth" services/catalog services/tracking services/reporting --exclude-dir=node_modules`
Expected: no output.

- [ ] **Step 3: Install, typecheck, lint**

Run: `pnpm install && pnpm typecheck && pnpm lint`
Expected: exit 0.

- [ ] **Step 4: Run all four services, then verify through Kong**

Run, in the background: `pnpm -r --filter './services/*' --parallel dev`. Wait for 4× `Nest application successfully started`.

Run: `for s in auth catalog tracking reporting; do printf "%s " $s; curl -s -w ' %{http_code}\n' localhost:8000/$s/health; done`
Expected: 4 lines, each `{"db":"ok","kafka":"ok"} 200`.

- [ ] **Step 5: Verify that each service checks its own database**

Run: `docker compose stop pg-tracking; for s in auth catalog tracking reporting; do printf "%s " $s; curl -s -w ' %{http_code}\n' localhost:8000/$s/health; done; docker compose start pg-tracking`
Expected: only `tracking` returns `{"db":"down","kafka":"ok"} 503`; the other three return 200.

- [ ] **Step 6: Stop the dev processes and commit**

```bash
git add services/catalog services/tracking services/reporting pnpm-lock.yaml
git commit -m "Add catalog, tracking, reporting service skeletons"
```

---

### Task 5: Web app

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`

**Interfaces:**
- Produces: `@tt/web` with `dev` (port 5173) and `typecheck` scripts.

- [ ] **Step 1: `apps/web/package.json`**

```json
{
  "name": "@tt/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "19.3.0",
    "react-dom": "19.3.0"
  },
  "devDependencies": {
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "6.1.1",
    "typescript": "6.0.3",
    "vite": "8.3.1"
  }
}
```

- [ ] **Step 2: `apps/web/tsconfig.json`** (bundler resolution, not nodenext)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "noEmit": true
  },
  "include": ["src", "vite.config.ts"]
}
```

- [ ] **Step 3: `apps/web/vite.config.ts`**

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
});
```

- [ ] **Step 4: `apps/web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Time tracker</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: `apps/web/src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 6: `apps/web/src/App.tsx`**

```tsx
export function App() {
  return <h1>Time tracker</h1>;
}
```

- [ ] **Step 7: Install, typecheck, lint**

Run: `pnpm install && pnpm --filter @tt/web typecheck && pnpm lint`
Expected: exit 0. Apply the `allowBuilds` rule if install fails.

- [ ] **Step 8: Verify it renders**

Run, in the background: `pnpm --filter @tt/web dev`. Then run `curl -s localhost:5173 | grep -o '<title>Time tracker</title>'`.
Expected: `<title>Time tracker</title>`. Then stop the dev server.

- [ ] **Step 9: Commit**

```bash
git add apps/web pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "Add React + Vite web app skeleton"
```

---

### Task 6: End-to-end verification + CLAUDE.md commands

**Files:**
- Modify: `CLAUDE.md` (add a `## Commands` section after `## Stack`)

- [ ] **Step 1: Run every spec "Done when" check from a clean state**

```bash
pnpm infra:down && pnpm install && pnpm infra:up      # 1: exit 0
docker compose ps --format '{{.Service}} {{.Health}}' # 1: all healthy
```

Run, in the background: `pnpm dev` (check 2: 4 services and web start).

```bash
for s in auth catalog tracking reporting; do curl -s -w " %{http_code}\n" localhost:8000/$s/health; done   # 3: 4x 200
docker compose stop pg-catalog; curl -s -w " %{http_code}\n" localhost:8000/catalog/health; docker compose start pg-catalog   # 4: 503
docker compose exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list   # 5: 5 topics
curl -s localhost:5173 | grep -c 'Time tracker'       # 6: 1
pnpm typecheck && pnpm lint                            # 7: exit 0
```

Expected: every check matches its comment. If any check fails, fix it before continuing, using superpowers:systematic-debugging.

- [ ] **Step 2: Add the `## Commands` section to CLAUDE.md** (directly after the `## Stack` section)

```markdown
## Commands

- First run: `pnpm install && for s in services/*; do cp -n $s/.env.example $s/.env; done`
- Infra (Kafka, 4× Postgres, Redis, Kong): `pnpm infra:up` / `pnpm infra:down`. `infra:up` also creates the Kafka topics; it's safe to re-run.
- Run everything (4 services + web, hot reload): `pnpm dev`. One service: `pnpm --filter @tt/<name> dev`.
- Health through Kong: `curl localhost:8000/<auth|catalog|tracking|reporting>/health`
- Checks: `pnpm typecheck`, `pnpm lint`
- Ports: services 3001–3004 (auth, catalog, tracking, reporting) · web 5173 · Kong 8000 · Postgres 5433–5436 · Kafka 9092 · Redis 6379
- New dependencies: pin exact versions. pnpm fails install on unreviewed install scripts; decide each one in `allowBuilds` in `pnpm-workspace.yaml`.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "Document dev commands in CLAUDE.md"
```

- [ ] **Step 4: Branch review**

Dispatch the `reviewer` agent with `model: "opus"` on `git diff main...scaffold`. Address its findings before merging.
