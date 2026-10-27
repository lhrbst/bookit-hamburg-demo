import { test, expect } from './support/test';

test('built SPA loads runtime configuration and exposes the public demo limitation', async ({ page, request }) => {
  const config = await request.get('/config.json');
  expect(config.headers()['cache-control']).toBe('no-store');
  await page.goto('/resources');
  await expect(page.getByRole('note')).toContainText('Synthetic data only');
  await expect(page.getByRole('heading', { name: /resources/i })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: /resources/i })).toBeVisible();
});

for (const failure of ['missing', 'invalid', 'unsafe'] as const) {
  test(`configuration ${failure} prevents API calls and announces a reload action`, async ({ page }) => {
    let apiRequests = 0;
    page.on('request', (request) => { if (request.url().includes('/api/')) apiRequests += 1; });
    await page.route('**/config.json', (route) => failure === 'missing'
      ? route.fulfill({ status: 404 })
      : route.fulfill({ json: failure === 'invalid' ? {} : { apiBaseUrl: 'http://insecure.example' } }));
    await page.goto('/today');
    await expect(page.getByRole('alert')).toContainText('Application configuration could not be loaded');
    await expect(page.getByRole('button', { name: 'Reload application' })).toBeVisible();
    expect(apiRequests).toBe(0);
  });
}
