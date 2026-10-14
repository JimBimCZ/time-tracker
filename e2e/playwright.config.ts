import { defineConfig } from '@playwright/test';

const services = [
  ['auth', 3001],
  ['catalog', 3002],
  ['tracking', 3003],
  ['reporting', 3004],
] as const;

// --dir (not --filter) avoids pnpm's "recursive run" SIGTERM error noise on shutdown.
// Infra (Postgres, Kafka, Redis, Kong) must already be up: `pnpm e2e` runs `infra:up` first.
const server = (name: string, dir: string, url: string) => ({
  name,
  // One "[ELIFECYCLE] ... signal SIGTERM" line per server on shutdown is expected, not a failure.
  command: `pnpm --dir ${dir} dev`,
  url,
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
  gracefulShutdown: { signal: 'SIGTERM' as const, timeout: 5_000 },
});

export default defineConfig({
  testDir: 'tests',
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:8000' },
  // A service's /health returns 200 only once its Postgres and Kafka are reachable.
  webServer: [
    ...services.map(([name, port]) => server(name, `../services/${name}`, `http://localhost:${port}/health`)),
    server('web', '../apps/web', 'http://localhost:5173'),
  ],
});
