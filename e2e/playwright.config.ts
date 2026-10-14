import { defineConfig } from '@playwright/test';

const services = [
  ['auth', 3001],
  ['catalog', 3002],
  ['tracking', 3003],
  ['reporting', 3004],
] as const;

// Infra (Postgres, Kafka, Redis, Kong) must already be up: `pnpm e2e` runs `infra:up` first.
const server = (name: string, dir: string, url: string) => ({
  name,
  // --dir, not --filter: --filter prints a "recursive run" failure block on SIGTERM shutdown.
  // One "[ELIFECYCLE] ... signal SIGTERM" line per server is still expected, not a failure.
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
