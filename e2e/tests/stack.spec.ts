import { expect, test } from '@playwright/test';

for (const svc of ['auth', 'catalog', 'tracking', 'reporting']) {
  test(`${svc} is healthy through Kong`, async ({ request }) => {
    const res = await request.get(`/${svc}/health`);
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ db: 'ok', kafka: 'ok' });
  });
}

test('Kong does not match look-alike prefixes', async ({ request }) => {
  const res = await request.get('/authx/health');
  expect(res.status()).toBe(404);
});

test('Kong rate limiting is active', async ({ request }) => {
  const res = await request.get('/auth/health');
  expect(res.headers()['x-ratelimit-limit-minute']).toBe('100');
});

test('web app renders', async ({ page }) => {
  await page.goto('http://localhost:5173');
  await expect(page.getByRole('heading', { name: 'Time tracker' })).toBeVisible();
});
