# End-to-end smoke test — design

**Date:** 2026-10-14
**Scope:** one Playwright suite that proves the whole stack is wired correctly. No CI wiring and no feature flows yet.

## Goal

One command, `pnpm e2e`, boots the infrastructure, the 4 services and the web app, then checks every hop:
UI → Kong → service → its own Postgres and Kafka, plus Kong's route boundary and its Redis-backed rate limiting.

The suite grows into real user flows (sign up → ticket → timer → monthly total) as features land.

## Layout

```
e2e/package.json              @tt/e2e, devDependency @playwright/test 1.63.0
e2e/playwright.config.ts      webServer array, baseURL = Kong
e2e/tests/stack.spec.ts       the tests below
pnpm-workspace.yaml           + e2e
package.json                  + "e2e": "pnpm infra:up && pnpm --filter @tt/e2e test"
.gitignore                    + test-results/, playwright-report/
```

The version is `1.63.0` because `1.64.0` (released 2026-10-07) is less than two weeks old. Only Chromium is installed (`pnpm --filter @tt/e2e exec playwright install chromium`).

## Boot

- **Infrastructure** comes from `pnpm infra:up`, which already waits for health and is safe to re-run. Playwright does not manage Docker.
- **Apps:** `webServer` has 5 entries. Each runs `pnpm --filter @tt/<name> dev`, which uses the package dir as cwd, so each service loads its own `.env`. The `.env` files come from the first-run `cp -n .env.example .env`.
  - **Services are ready** when `http://localhost:300x/health` returns 200. That only happens once the service's DB and Kafka are reachable.
  - **The web app is ready** when `http://localhost:5173` responds.
- **`reuseExistingServer: !process.env.CI`:** locally, a running `pnpm dev` is reused.
- **`gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 }`:** Nest's shutdown hooks run instead of a hard SIGKILL.

## Tests

`baseURL` is `http://localhost:8000` (Kong).

1. **Health through Kong:** for each of `auth`, `catalog`, `tracking` and `reporting`, `GET /<svc>/health` → `200`, body `{ db: "ok", kafka: "ok" }`.
2. **Route boundary:** `GET /authx/health` → `404`.
3. **Rate limiting:** a proxied response has the header `x-ratelimit-limit-minute: 100`, confirmed against Kong 3.9.2. This shows the plugin is active. It does not exercise the limit.
4. **Web:** the page at `http://localhost:5173` shows the heading "Time tracker".

## Out of scope

- CI workflow: the next step, which runs `pnpm e2e`.
- Docker image builds.
- Feature flows: added with each feature.
- Exhausting the rate limit: it is shared per IP, so it would throttle the other tests.
