import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  outputDir: '../.local/playwright-artifacts',
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: '../.local/playwright-report' }],
    ['junit', { outputFile: '../.local/playwright-results.xml' }],
  ],
  use: {
    baseURL: 'http://localhost:5173',
    timezoneId: 'Europe/Berlin',
    locale: 'de-DE',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npx tsx test-support/server.ts',
      cwd: '../backend',
      url: 'http://localhost:3001/ready',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'node scripts/serve.mjs dist',
      cwd: '.',
      url: 'http://localhost:5173',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
