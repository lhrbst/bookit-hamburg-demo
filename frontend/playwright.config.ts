import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the foundation-layer E2E smoke tests (issue #23).
 *
 * Runs against a *real* backend (Postgres-backed Express API on
 * `http://localhost:3001`) and the Vite dev server (`http://localhost:5173`).
 * No API mocking for the primary journeys — see `e2e/README.md` (well, this
 * comment) for why: this ticket's AC is about the plumbing actually
 * reaching the live contract, not about UI polish.
 *
 * `webServer` starts both dev servers if they are not already running
 * (`reuseExistingServer: true` locally so a developer's already-running
 * `npm run dev` instances are reused instead of double-started; CI always
 * starts fresh). The backend must have `CORS_ORIGIN=http://localhost:5173`
 * in `backend/.env` for the frontend origin to be allowed — do not change
 * the port.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    timezoneId: 'Europe/Berlin',
    locale: 'de-DE',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npm run dev',
      cwd: '../backend',
      url: 'http://localhost:3001/health',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'npm run dev',
      cwd: '.',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
