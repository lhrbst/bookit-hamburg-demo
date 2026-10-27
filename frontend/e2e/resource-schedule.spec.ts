import { test, expect } from './support/test';
import AxeBuilder from '@axe-core/playwright';
import { fetchLiveResources, fetchLiveSchedule, NON_EXISTENT_RESOURCE_ID } from './support/api';

const TEST_DATE = '2026-01-01';

/**
 * Issue #23 ACs covered by this file:
 *  - "Routes exist for ... resource schedule (with resource and day in the
 *    URL) ..."
 *  - "Not-found responses are distinguishable from network/unexpected
 *    failures by callers."
 *
 * PLUMBING only: no segment rendering/chronology assertions (issue #26).
 */
test.describe('resource schedule route (/resources/:resourceId/schedule/:date)', () => {
  test('AC: resolves the schedule for a real resource and day taken straight from the URL', async ({
    page,
    request,
  }) => {
    const liveResources = await fetchLiveResources(request);
    test.skip(liveResources.length === 0, 'requires at least one seeded resource');
    const [resource] = liveResources;
    const liveSchedule = await fetchLiveSchedule(request, resource.id);

    await page.goto(`/resources/${resource.id}/schedule/${TEST_DATE}`);

    await expect(
      page.getByRole('heading', {
        level: 1,
        name: `Schedule for resource ${resource.id} on ${TEST_DATE}`,
      }),
    ).toBeVisible();

    // Real chronological segment rendering (issue #26) replaced the old
    // placeholder text: the schedule's segments are rendered as a list
    // whose accessible name uses the resource's *name* (not its id,
    // unlike the heading above), with one `<li>` per segment returned by
    // the live backend for this resource/day.
    const list = page.getByRole('list', {
      name: `Schedule for ${resource.name} on ${TEST_DATE}`,
    });
    await expect(list).toBeVisible();
    await expect(list.getByRole('listitem')).toHaveCount(liveSchedule.segments.length);
  });

  test('AC: not-found is distinguishable from an unexpected failure — different message, and no retry offered for a permanent 404', async ({
    page,
  }) => {
    // --- Branch 1: a well-formed 404 from the real backend for a resource
    // id that is syntactically valid but does not exist. ---
    await page.goto(`/resources/${NON_EXISTENT_RESOURCE_ID}/schedule/${TEST_DATE}`);

    const notFoundAlert = page.getByRole('alert');
    await expect(notFoundAlert).toBeVisible();
    await expect(notFoundAlert).toContainText('This resource no longer exists.');
    await expect(notFoundAlert).not.toContainText('could not be loaded');
    await expect(notFoundAlert.getByRole('button', { name: 'Retry' })).toHaveCount(0);

    // --- Branch 2: a genuine network failure (no response reaches the
    // backend at all) for an otherwise-real resource id — must render the
    // *generic* unexpected-failure copy, with a retry, never the
    // not-found copy. This is the observable proof that the two failure
    // kinds are kept distinct by the caller. ---
    const liveResources = await (
      await page.request.get('http://localhost:3001/api/resources')
    ).json();
    test.skip(liveResources.length === 0, 'requires at least one seeded resource');
    const [resource] = liveResources;

    await page.route('**/api/resources/*/schedule*', (route) => route.abort('failed'));
    await page.goto(`/resources/${resource.id}/schedule/${TEST_DATE}`);

    const unexpectedAlert = page.getByRole('alert');
    await expect(unexpectedAlert).toBeVisible({ timeout: 15_000 });
    await expect(unexpectedAlert).toContainText('The schedule could not be loaded.');
    await expect(unexpectedAlert).not.toContainText('no longer exists');
    await expect(unexpectedAlert.getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  test('AC-10: a not-found resource schedule offers a real, keyboard-operable link back to the resource list, announced inside the same alert', async ({
    page,
  }) => {
    await page.goto(`/resources/${NON_EXISTENT_RESOURCE_ID}/schedule/${TEST_DATE}`);

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('This resource no longer exists.');

    // The "how to continue" affordance must be a real link, inside the
    // same alert as the "what happened" message — not a separate,
    // unannounced control — so a screen reader user gets both together.
    const returnLink = alert.getByRole('link', { name: 'Return to the resource list' });
    await expect(returnLink).toBeVisible();

    // Keyboard path: reachable by Tab/focus and activatable with Enter
    // alone, with no mouse involved.
    await returnLink.focus();
    await expect(returnLink).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/resources$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Resources' })).toBeVisible();
    // The destination actually rendered the resource list, not just the
    // right URL — a real, populated list, from the live backend.
    await expect(page.getByRole('main').getByRole('list')).toBeVisible();

    // Mouse path: the same link is also operable by click, from a fresh
    // not-found visit.
    await page.goto(`/resources/${NON_EXISTENT_RESOURCE_ID}/schedule/${TEST_DATE}`);
    const alertAgain = page.getByRole('alert');
    await expect(alertAgain).toBeVisible();
    await alertAgain.getByRole('link', { name: 'Return to the resource list' }).click();

    await expect(page).toHaveURL(/\/resources$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Resources' })).toBeVisible();
    await expect(page.getByRole('main').getByRole('list')).toBeVisible();
  });

  test('AC: retrying after an unexpected schedule failure succeeds once the backend is reachable again', async ({
    page,
    request,
  }) => {
    const liveResources = await fetchLiveResources(request);
    test.skip(liveResources.length === 0, 'requires at least one seeded resource');
    const [resource] = liveResources;

    let shouldFail = true;
    await page.route('**/api/resources/*/schedule*', async (route) => {
      if (shouldFail) {
        await route.abort('failed');
        return;
      }
      await route.continue();
    });

    await page.goto(`/resources/${resource.id}/schedule/${TEST_DATE}`);
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible({ timeout: 15_000 });
    shouldFail = false;
    await alert.getByRole('button', { name: 'Retry' }).click();

    await expect(alert).not.toBeVisible();
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: `Schedule for resource ${resource.id} on ${TEST_DATE}`,
      }),
    ).toBeVisible();
  });

  test('AC: shows a loading state while the schedule is being fetched', async ({
    page,
    request,
  }) => {
    const liveResources = await fetchLiveResources(request);
    test.skip(liveResources.length === 0, 'requires at least one seeded resource');
    const [resource] = liveResources;

    await page.route('**/api/resources/*/schedule*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue();
    });

    await page.goto(`/resources/${resource.id}/schedule/${TEST_DATE}`);
    await expect(page.getByText('Loading schedule…')).toBeVisible();
  });

  test('AC: the resource schedule view has no automatically detectable accessibility violations', async ({
    page,
    request,
  }) => {
    const liveResources = await fetchLiveResources(request);
    test.skip(liveResources.length === 0, 'requires at least one seeded resource');
    const [resource] = liveResources;

    await page.goto(`/resources/${resource.id}/schedule/${TEST_DATE}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
