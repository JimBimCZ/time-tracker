import { defineConfig } from '@playwright/test';

const services = [
  ['auth', 3001],
  ['catalog', 3002],
  ['tracking', 3003],
  ['reporting', 3004],
] as const;

// Infra (Postgres, Kafka, Redis, Kong) must already be up: `pnpm e2e` runs `infra:up` first.
const server = (name: string, url: string) => ({
  name,
  command: `pnpm --filter @tt/${name} dev`,
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
    ...services.map(([name, port]) => server(name, `http://localhost:${port}/health`)),
    server('web', 'http://localhost:5173'),
  ],
});
