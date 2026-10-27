import { test as base, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const fixed = new Date('2026-08-31T10:00:00Z');
let currentTime = fixed.getTime();
const RealDate = Date;
class TestDate extends RealDate {
  constructor(value?: string | number) {
    super(value ?? currentTime);
  }
  static now(): number { return currentTime; }
}
globalThis.Date = TestDate as DateConstructor;

export function setTestTime(value: Date): void {
  currentTime = value.getTime();
  writeFileSync(new URL('../../../.local/e2e-clock.json', import.meta.url), JSON.stringify(value.toISOString()));
}

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.clock.setFixedTime(fixed);
    await use(page);
  },
});
test.beforeEach(() => setTestTime(fixed));
export { expect };
export type { Page, Locator, APIRequestContext } from '@playwright/test';
