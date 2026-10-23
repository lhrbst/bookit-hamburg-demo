import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Issue #23 ACs covered by this file:
 *  - "Routes exist for resource list ... and today overview." (root redirect)
 *  - "Today overview has its own entry point in navigation."
 */
test.describe('navigation shell', () => {
  test('AC: root path redirects to the resource list route', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/resources$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Resources' })).toBeVisible();
  });

  test('AC: the main nav is a real, named landmark present on every route', async ({ page }) => {
    await page.goto('/resources');
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Resources' })).toBeVisible();
    await expect(nav.getByRole('link', { name: "Today's bookings" })).toBeVisible();

    await page.goto('/today');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  });

  test('AC: today overview has its own entry point in navigation, reachable by keyboard alone', async ({
    page,
  }) => {
    await page.goto('/resources');

    // Drive the primary journey by keyboard only: Tab to the "Today's
    // bookings" nav link, then Enter to activate it — no mouse click.
    const todayLink = page.getByRole('link', { name: "Today's bookings" });
    await page.keyboard.press('Tab'); // -> "Resources" link (first focusable)
    await expect(page.getByRole('link', { name: 'Resources' })).toBeFocused();
    await page.keyboard.press('Tab'); // -> "Today's bookings" link
    await expect(todayLink).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/today$/);
    await expect(page.getByRole('heading', { level: 1, name: "Today's bookings" })).toBeVisible();
  });

  test('AC: the nav has no automatically detectable accessibility violations', async ({ page }) => {
    await page.goto('/resources');
    const results = await new AxeBuilder({ page }).include('nav').analyze();
    expect(results.violations).toEqual([]);
  });
});
