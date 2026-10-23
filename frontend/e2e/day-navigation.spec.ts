import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fetchLiveResources } from './support/api';

/**
 * Issue #24 ACs covered by this file (day navigation on
 * `/resources/:resourceId/schedule/:date`, FS-01 FR-2/§12):
 *
 *  - "Day keys are correct regardless of the browser time zone."
 *  - "Day navigation moves exactly one calendar day, correctly across
 *    month, year and DST boundaries."
 *  - (Accessibility floor) the new `<nav aria-label="Day navigation">`
 *    introduces no automatically detectable violations, and its three
 *    buttons are keyboard-operable in DOM order.
 *
 * Out of scope (see issue #24 hand-off notes): schedule segment
 * rendering/chronology (#26), `formatContinuationLabel`/`formatBerlinTime`
 * (not wired into any visible UI yet), filters (#27), booking
 * creation/cancellation (later issues).
 */

/** Computes today's Europe/Berlin calendar date, independent of the
 * machine/browser running the test — used as ground truth instead of a
 * hardcoded date, since real system time can't be frozen in this repo. */
function todayInBerlin(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

test.describe('resource schedule day navigation (/resources/:resourceId/schedule/:date)', () => {
  test('AC: Previous day / Today / Next day are reachable and operable by keyboard alone, in that order, each moving the URL and heading by exactly one calendar day', async ({
    page,
    request,
  }) => {
    const liveResources = await fetchLiveResources(request);
    test.skip(liveResources.length === 0, 'requires at least one seeded resource');
    const [resource] = liveResources;

    await page.goto(`/resources/${resource.id}/schedule/2026-01-15`);
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: `Schedule for resource ${resource.id} on 2026-01-15`,
      }),
    ).toBeVisible();

    const previousDayButton = page.getByRole('button', { name: 'Previous day' });
    const todayButton = page.getByRole('button', { name: 'Today' });
    const nextDayButton = page.getByRole('button', { name: 'Next day' });

    // Tab from a blank focus position through the page's other focusable
    // chrome (main nav links) until the three day-navigation buttons, in
    // DOM order, confirming each is reachable and activatable without a
    // mouse.
    await page.keyboard.press('Tab'); // -> "Resources" main nav link
    await page.keyboard.press('Tab'); // -> "Today's bookings" main nav link
    await page.keyboard.press('Tab'); // -> "Previous day"
    await expect(previousDayButton).toBeFocused();
    await page.keyboard.press('Tab'); // -> "Today"
    await expect(todayButton).toBeFocused();
    await page.keyboard.press('Tab'); // -> "Next day"
    await expect(nextDayButton).toBeFocused();

    // Activate "Next day" with Enter — moves exactly one calendar day
    // forward.
    await nextDayButton.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/schedule/2026-01-16$`));
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: `Schedule for resource ${resource.id} on 2026-01-16`,
      }),
    ).toBeVisible();

    // Activate "Previous day" with Space — moves exactly one calendar day
    // back, twice, to prove it isn't a no-op/coincidence.
    await previousDayButton.focus();
    await page.keyboard.press('Space');
    await expect(page).toHaveURL(new RegExp(`/schedule/2026-01-15$`));
    await previousDayButton.focus();
    await page.keyboard.press('Space');
    await expect(page).toHaveURL(new RegExp(`/schedule/2026-01-14$`));
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: `Schedule for resource ${resource.id} on 2026-01-14`,
      }),
    ).toBeVisible();

    // Activate "Today" with Enter — jumps to today's real Europe/Berlin
    // calendar date, not a one-day step from wherever we were.
    const expectedToday = todayInBerlin();
    await todayButton.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/schedule/${expectedToday}$`));
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: `Schedule for resource ${resource.id} on ${expectedToday}`,
      }),
    ).toBeVisible();
  });

  test('AC: an invalid :date segment in the URL is redirected to today’s canonical Europe/Berlin date', async ({
    page,
    request,
  }) => {
    const liveResources = await fetchLiveResources(request);
    test.skip(liveResources.length === 0, 'requires at least one seeded resource');
    const [resource] = liveResources;
    const expectedToday = todayInBerlin();

    await page.goto(`/resources/${resource.id}/schedule/not-a-date`);

    await expect(page).toHaveURL(new RegExp(`/resources/${resource.id}/schedule/${expectedToday}$`));
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: `Schedule for resource ${resource.id} on ${expectedToday}`,
      }),
    ).toBeVisible();
  });

  test('AC: "Today" resolves to the Europe/Berlin calendar date, not the browser’s own configured time zone', async ({
    browser,
    request,
  }) => {
    const liveResources = await fetchLiveResources(request);
    test.skip(liveResources.length === 0, 'requires at least one seeded resource');
    const [resource] = liveResources;
    const expectedBerlinToday = todayInBerlin();

    // Emulate a browser configured for a time zone far from Europe/Berlin
    // (Kiritimati, UTC+14) so that if "today" were ever computed from the
    // browser's own local clock instead of Europe/Berlin, the calendar
    // date would very likely disagree with Berlin's.
    const context = await browser.newContext({ timezoneId: 'Pacific/Kiritimati' });
    const page = await context.newPage();

    await page.goto(`/resources/${resource.id}/schedule/not-a-date`);

    await expect(
      page,
    ).toHaveURL(new RegExp(`/resources/${resource.id}/schedule/${expectedBerlinToday}$`));
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: `Schedule for resource ${resource.id} on ${expectedBerlinToday}`,
      }),
    ).toBeVisible();

    await context.close();
  });

  test('AC: one day of navigation correctly crosses a year boundary', async ({ page, request }) => {
    const liveResources = await fetchLiveResources(request);
    test.skip(liveResources.length === 0, 'requires at least one seeded resource');
    const [resource] = liveResources;

    await page.goto(`/resources/${resource.id}/schedule/2025-12-31`);
    await page.getByRole('button', { name: 'Next day' }).click();

    await expect(page).toHaveURL(new RegExp(`/schedule/2026-01-01$`));
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: `Schedule for resource ${resource.id} on 2026-01-01`,
      }),
    ).toBeVisible();
  });

  test('AC: one day of navigation is correct across the autumn Europe/Berlin DST boundary (2026-10-25)', async ({
    page,
    request,
  }) => {
    const liveResources = await fetchLiveResources(request);
    test.skip(liveResources.length === 0, 'requires at least one seeded resource');
    const [resource] = liveResources;

    await page.goto(`/resources/${resource.id}/schedule/2026-10-25`);
    await page.getByRole('button', { name: 'Next day' }).click();

    await expect(page).toHaveURL(new RegExp(`/schedule/2026-10-26$`));
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: `Schedule for resource ${resource.id} on 2026-10-26`,
      }),
    ).toBeVisible();
  });

  test('AC: one day of navigation is correct across the spring Europe/Berlin DST boundary (2026-03-29)', async ({
    page,
    request,
  }) => {
    const liveResources = await fetchLiveResources(request);
    test.skip(liveResources.length === 0, 'requires at least one seeded resource');
    const [resource] = liveResources;

    await page.goto(`/resources/${resource.id}/schedule/2026-03-29`);
    await page.getByRole('button', { name: 'Next day' }).click();

    await expect(page).toHaveURL(new RegExp(`/schedule/2026-03-30$`));
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: `Schedule for resource ${resource.id} on 2026-03-30`,
      }),
    ).toBeVisible();
  });

  test('AC: the day-navigation controls introduce no automatically detectable accessibility violations', async ({
    page,
    request,
  }) => {
    const liveResources = await fetchLiveResources(request);
    test.skip(liveResources.length === 0, 'requires at least one seeded resource');
    const [resource] = liveResources;

    await page.goto(`/resources/${resource.id}/schedule/2026-01-15`);
    await expect(page.getByRole('navigation', { name: 'Day navigation' })).toBeVisible();

    const results = await new AxeBuilder({ page }).include('nav[aria-label="Day navigation"]').analyze();
    expect(results.violations).toEqual([]);
  });
});
