import { test, expect } from './support/test';
import AxeBuilder from '@axe-core/playwright';
import { fetchLiveResources, type LiveResource } from './support/api';
import { todayInBerlin } from './support/dates';

/**
 * Covers issue #25 (Task 3.1, Phase 3 — UI views; FS-01 FR-1/§6.1/AC-1):
 *
 *  - AC-1: every resource is shown with its name and short description.
 *  - Selecting a resource opens its schedule for today.
 *  - Description-less resources render without an empty gap or
 *    placeholder text.
 *  - Empty catalogue shows an explanatory message.
 *
 * The loading state and the fetch-failure/retry state are issue #23's
 * concern and are UNCHANGED by #25 — they are re-asserted here only as a
 * light smoke check per the ticket, not re-derived.
 */
test.describe('resource list route (/resources)', () => {
  test('AC-1: every resource is shown with its name and (when non-empty) its description, from the live catalogue', async ({
    page,
    request,
  }) => {
    const liveResources = await fetchLiveResources(request);
    test.skip(liveResources.length === 0, 'requires at least one seeded resource');

    await page.goto('/resources');

    await expect(page.getByRole('heading', { level: 1, name: 'Resources' })).toBeVisible();

    const main = page.getByRole('main');
    const list = main.getByRole('list');
    await expect(list).toBeVisible();
    await expect(main.getByRole('listitem')).toHaveCount(liveResources.length);

    for (const resource of liveResources) {
      const link = page.getByRole('link', { name: resource.name });
      await expect(link).toBeVisible();

      if (resource.description.trim() !== '') {
        await expect(link).toContainText(resource.description);
      }
    }
  });

  test('rooms and shared equipment resources are listed together, without grouping headers', async ({
    page,
    request,
  }) => {
    const liveResources = await fetchLiveResources(request);
    const hasRoom = liveResources.some((r) => r.type === 'room');
    const hasEquipment = liveResources.some((r) => r.type === 'equipment');
    test.skip(
      !hasRoom || !hasEquipment,
      'requires at least one room and one equipment resource in seed data',
    );

    await page.goto('/resources');

    // A single flat list: exactly one `<ul>`/list role on the page, and no
    // subheading splitting rooms from equipment (only the page's own h1).
    const main = page.getByRole('main');
    await expect(main.getByRole('list')).toHaveCount(1);
    await expect(main.getByRole('listitem')).toHaveCount(liveResources.length);
    await expect(main.getByRole('heading')).toHaveCount(1);
  });

  test('selecting a resource opens its schedule for today, driven entirely by keyboard', async ({
    page,
    request,
  }) => {
    const liveResources = await fetchLiveResources(request);
    test.skip(liveResources.length === 0, 'requires at least one seeded resource');
    const [first] = liveResources;

    await page.goto('/resources');
    const link = page.getByRole('link', { name: first.name });
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press('Enter');

    const today = todayInBerlin();
    await expect(page).toHaveURL(
      new RegExp(`/resources/${first.id}/schedule/${today}$`),
    );
  });

  test('a description-less resource renders its name with no empty gap and no placeholder text', async ({
    page,
  }) => {
    // Rendering-only concern: exercised by intercepting the one HTTP
    // response with a synthetic description-less resource alongside a
    // described one, rather than mutating the shared Postgres seed data
    // (keeps this test deterministic and safe to run in parallel with the
    // others, which read the real catalogue).
    const described: LiveResource = {
      id: '99999999-9999-9999-9999-999999999991',
      name: 'Described Test Room',
      type: 'room',
      description: 'Has a description',
    };
    const descriptionLess: LiveResource = {
      id: '99999999-9999-9999-9999-999999999992',
      name: 'Description-less Test Cart',
      type: 'equipment',
      description: '',
    };

    await page.route('**/api/resources', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([described, descriptionLess]),
      });
    });

    await page.goto('/resources');

    const describedLink = page.getByRole('link', { name: described.name });
    await expect(describedLink).toBeVisible();
    await expect(describedLink).toContainText(described.description);

    // The whole link's accessible name is exactly the resource name: no
    // trailing whitespace from an empty description span, and no
    // placeholder such as "No description".
    const bareLink = page.getByRole('link', { name: descriptionLess.name, exact: true });
    await expect(bareLink).toBeVisible();
    await expect(bareLink).toHaveAccessibleName(descriptionLess.name);
    await expect(bareLink).not.toContainText('No description');
  });

  test('AC: shows a loading state while the resource list is being fetched', async ({ page }) => {
    await page.route('**/api/resources', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue();
    });

    await page.goto('/resources');
    await expect(page.getByText('Loading resources…')).toBeVisible();
  });

  test('empty catalogue shows an explanatory message, not a blank page', async ({ page }) => {
    // The real seed data always has resources, and this ticket must not
    // touch Postgres — so the empty-array branch is exercised by
    // intercepting the one HTTP response, not by faking the whole journey.
    await page.route('**/api/resources', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    await page.goto('/resources');

    await expect(page.getByRole('heading', { level: 1, name: 'Resources' })).toBeVisible();
    await expect(
      page.getByText('No resources are available to book yet. Please check back later.'),
    ).toBeVisible();
    await expect(page.getByRole('main').getByRole('list')).toHaveCount(0);
  });

  test('AC: an unexpected failure is announced and offers a working retry, preserving no stale data', async ({
    page,
  }) => {
    // Keep failing (a genuine network failure — no response at all,
    // matching `ApiError#isNetworkFailure`) until the error state has been
    // observed, then let the *next* request (triggered by clicking Retry)
    // succeed. TanStack Query retries transparently a few times on its
    // own before surfacing `isError`, so the alert only appears once those
    // internal retries are exhausted — hence the generous timeout below.
    let shouldFail = true;
    await page.route('**/api/resources', async (route) => {
      if (shouldFail) {
        await route.abort('failed');
        return;
      }
      await route.continue();
    });

    await page.goto('/resources');

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(alert).toContainText('Resources could not be loaded.');
    const retry = alert.getByRole('button', { name: 'Retry' });
    await expect(retry).toBeVisible();

    shouldFail = false;
    await retry.click();

    await expect(alert).not.toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Resources' })).toBeVisible();
  });

  test('the populated resource list is announced to assistive tech as a heading followed by a list', async ({
    page,
    request,
  }) => {
    const liveResources = await fetchLiveResources(request);
    test.skip(liveResources.length === 0, 'requires at least one seeded resource');

    await page.goto('/resources');
    const heading = page.getByRole('heading', { level: 1, name: 'Resources' });
    const list = page.getByRole('main').getByRole('list');
    await expect(heading).toBeVisible();
    await expect(list).toBeVisible();

    // Reading/tab order for assistive tech follows document order — assert
    // the heading node precedes the list node in the DOM (this is what
    // `getByRole` itself queries against), not merely that both exist.
    const listHandle = await list.elementHandle();
    const headingPrecedesList = await heading.evaluate(
      (headingEl, listEl) =>
        !!listEl &&
        (headingEl.compareDocumentPosition(listEl) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      listHandle,
    );
    expect(headingPrecedesList).toBe(true);
  });

  test('the resource list view has no automatically detectable accessibility violations', async ({
    page,
    request,
  }) => {
    const liveResources = await fetchLiveResources(request);
    test.skip(liveResources.length === 0, 'requires at least one seeded resource');

    await page.goto('/resources');
    await expect(page.getByRole('heading', { level: 1, name: 'Resources' })).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
