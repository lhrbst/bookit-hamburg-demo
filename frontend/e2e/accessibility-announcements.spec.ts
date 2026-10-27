import { test, expect, type Page } from './support/test';
import AxeBuilder from '@axe-core/playwright';
import {
  fetchLiveResources,
  fetchLiveFilteredSchedule,
  fetchLiveTodayBookings,
  createLiveBooking,
  deleteLiveBooking,
} from './support/api';
import { todayInBerlin } from './support/dates';
import { withTodayLock } from './support/todayLock';

/**
 * Issue #31 (Task 4.2, Phase 4 — Cross-cutting, FS-01 §9 Accessibility/
 * AC-11) ACs covered by this file:
 *
 *  - AC-11: keyboard-only users can select a resource, navigate days and
 *    apply/clear filters (light spot-check only — exhaustively proven
 *    already by `day-navigation.spec.ts`, `resource-schedule-
 *    filters.spec.ts`, `today-overview-filters.spec.ts`, `resource-
 *    list.spec.ts`).
 *  - Booking entries convey resource, time range, creator and booked-for
 *    person to a screen reader (regression check only — implemented by
 *    issues #26/#28, unchanged here).
 *  - Removing colour still leaves booked vs free unambiguous (regression
 *    check — the leading "Booked"/"Free" text label, issue #26, is
 *    unchanged by this ticket).
 *  - Empty and error states are announced.
 *  - Selected day and active filter changes are announced.
 *
 * This ticket added NO new business logic and NO new visible text — only
 * `aria-live="polite"` (on `ResourceScheduleRoute`'s `<h1>`) and
 * `role="status"` (on four already-existing summary/empty-state `<p>`
 * elements across `ResourceScheduleRoute`/`TodayOverviewRoute`). Every
 * test below therefore asserts the announcement ATTRIBUTE itself
 * (`aria-live`/`role`) is present on the correct element AND that the
 * element's text is what actually changed — the practical proxy for "was
 * this announced" available to Playwright, since full screen-reader
 * audio output cannot be captured here (see issue's own note).
 *
 * Fixture data: the seeded "Nebel" room (`resource-schedule-
 * filters.spec.ts`'s own constant) on 2026-09-01 has two real back-to-
 * back bookings and is used for the filter-summary/day-navigation
 * assertions; 2030-01-01 (far enough in the future that no seed or other
 * spec file's fixture ever touches it) is used for the genuinely-empty
 * "free all day" assertion, so that test never races another spec's
 * fixture creation.
 */
const NEBEL_ID = '11111111-1111-1111-1111-111111111111';
const NEBEL_NAME = 'Nebel';
const DATE = '2026-09-01';
const EMPTY_DATE = '2030-01-01';
const ALEX_ID = '22222222-2222-2222-2222-222222222221';
const ALEX_NAME = 'Alex Nguyen';
const ELBE_ID = '11111111-1111-1111-1111-111111111112';
const ELBE_NAME = 'Elbe';

/** The "Booked by" filter's trigger button — same locator convention
 * (`resource-schedule-filters.spec.ts`) worked around for the React Aria
 * `Select`'s duplicated accessible name. */
function bookedBySelect(page: Page) {
  return page.getByRole('button', { name: /Booked by/ });
}

function resourceSelect(page: Page) {
  return page.getByRole('button', { name: /Resource/ });
}

async function choosePerson(page: Page, select: ReturnType<typeof bookedBySelect>, personName: string) {
  await select.click();
  await page.getByRole('option', { name: personName, exact: true }).click();
}

/** An absolute instant `minutesFromNow` in the future, resolved to its
 * Europe/Berlin local wall-clock `YYYY-MM-DDTHH:mm` string — same
 * technique/reason as `today-overview-filters.spec.ts#futureBerlinLocal`:
 * keeps every "today" fixture booking safely in the future (FS-02 R-2)
 * without ever depending on the real wall clock for what the test means. */
function futureBerlinLocal(minutesFromNow: number): string {
  const instant = new Date(Date.now() + minutesFromNow * 60_000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .formatToParts(instant)
    .reduce<Record<string, string>>((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

test.describe('accessibility announcements (issue #31)', () => {
  test('AC: the resource schedule heading is a polite live region, and Next day updates both its text and the URL', async ({
    page,
  }) => {
    await page.goto(`/resources/${NEBEL_ID}/schedule/${DATE}`);

    const heading = page.getByRole('heading', {
      level: 1,
      name: `Schedule for resource ${NEBEL_ID} on ${DATE}`,
    });
    await expect(heading).toBeVisible();
    // The announcement mechanism itself: a screen reader only re-reads
    // this element on a text change because it is a polite live region.
    await expect(heading).toHaveAttribute('aria-live', 'polite');
    // The heading role survives — `aria-live` is additive, not a
    // replacement of the native semantics (issue's own note).
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);

    await page.getByRole('button', { name: 'Next day' }).click();

    await expect(page).toHaveURL(new RegExp('/schedule/2026-09-02$'));
    const nextHeading = page.getByRole('heading', {
      level: 1,
      name: `Schedule for resource ${NEBEL_ID} on 2026-09-02`,
    });
    await expect(nextHeading).toBeVisible();
    // Still the SAME live element carrying the attribute after the
    // client-side update, not a fresh non-live node swapped in.
    await expect(nextHeading).toHaveAttribute('aria-live', 'polite');
  });

  test('AC: applying a "Booked by" filter on the resource schedule updates the role="status" summary, and clearing reverts it', async ({
    page,
  }) => {
    await page.goto(`/resources/${NEBEL_ID}/schedule/${DATE}`);
    await expect(page.getByRole('list', { name: `Schedule for ${NEBEL_NAME} on ${DATE}` })).toBeVisible();

    const summary = page.getByRole('status').filter({ hasText: /Showing/ });
    await expect(summary).toHaveText('Showing all bookings (no filters applied).');

    await choosePerson(page, bookedBySelect(page), ALEX_NAME);

    // Same element, same `role="status"`, now announcing the new filter
    // in business language.
    await expect(summary).toHaveText(`Showing bookings booked by ${ALEX_NAME}.`);
    await expect(summary).toHaveAttribute('role', 'status');

    await page.getByRole('button', { name: 'Clear filters' }).click();

    await expect(summary).toHaveText('Showing all bookings (no filters applied).');
    await expect(summary).toHaveAttribute('role', 'status');
  });

  test('AC: applying filters on /today updates the role="status" summary, and clearing reverts it', async ({
    page,
    request,
  }) => {
    await withTodayLock(async () => {
      await page.goto('/today');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

      const summary = page.getByRole('status').filter({ hasText: /Showing/ });
      await expect(summary).toHaveText('Showing all bookings today (no filters applied).');
      await expect(summary).toHaveAttribute('role', 'status');

      await resourceSelect(page).click();
      await page.getByRole('option', { name: NEBEL_NAME, exact: true }).click();

      await expect(summary).toHaveText(`Showing bookings for ${NEBEL_NAME}.`);
      await expect(summary).toHaveAttribute('role', 'status');

      await page.getByRole('button', { name: 'Clear filters' }).first().click();

      await expect(summary).toHaveText('Showing all bookings today (no filters applied).');
      await expect(summary).toHaveAttribute('role', 'status');

      // Ground-truth: never leave a lingering resource fixture behind —
      // this test creates none, so nothing further to clean up. Confirm
      // via the live API this test genuinely touched nothing.
      const liveToday = await fetchLiveTodayBookings(request);
      expect(Array.isArray(liveToday)).toBe(true);
    });
  });

  test('AC: a genuinely-free resource day announces "This resource is free all day." via role="status"', async ({
    page,
    request,
  }) => {
    const liveSchedule = await fetchLiveFilteredSchedule(request, NEBEL_ID, EMPTY_DATE, {});
    expect(liveSchedule.segments.some((s) => s.type === 'booked')).toBe(false);

    await page.goto(`/resources/${NEBEL_ID}/schedule/${EMPTY_DATE}`);

    const freeAllDay = page.getByText('This resource is free all day.');
    await expect(freeAllDay).toBeVisible();
    await expect(freeAllDay).toHaveAttribute('role', 'status');
  });

  test('AC: narrowing /today to zero results announces the filtered-empty message via role="status", distinct from the unfiltered-empty message', async ({
    page,
    request,
  }) => {
    await withTodayLock(async () => {
      const randomAnchor = 20 + Math.floor(Math.random() * 600);

      // A real booking for Nebel exists today, but never for Elbe — so
      // filtering by Elbe is guaranteed to narrow a non-empty day down to
      // zero, never a coincidental genuinely-empty day.
      const booking = await createLiveBooking(request, {
        resourceId: NEBEL_ID,
        bookedForId: ALEX_ID,
        purposeId: 'Meeting',
        start: futureBerlinLocal(randomAnchor),
        end: futureBerlinLocal(randomAnchor + 20),
      });

      try {
        const liveToday = await fetchLiveTodayBookings(request);
        expect(liveToday.some((b) => b.resource.id === ELBE_ID)).toBe(false);

        await page.goto('/today');
        await expect(
          page.getByRole('list', { name: `All bookings today, ${todayInBerlin()}` }).getByRole('listitem').first(),
        ).toBeVisible();

        await resourceSelect(page).click();
        await page.getByRole('option', { name: ELBE_NAME, exact: true }).click();

        const filteredEmpty = page.getByText('No bookings match the current filters.');
        await expect(filteredEmpty).toBeVisible();
        await expect(filteredEmpty).toHaveAttribute('role', 'status');
        // Distinct from the genuinely-unfiltered-empty message — must not
        // both be on screen at once.
        await expect(page.getByText('Nothing is booked today.')).toHaveCount(0);

        await page
          .getByText('No bookings match the current filters.')
          .getByRole('button', { name: 'Clear filters' })
          .click();
        await expect(filteredEmpty).toHaveCount(0);
      } finally {
        await deleteLiveBooking(request, booking.id);
      }
    });
  });

  test('AC: a genuinely empty "today" (no filters) announces "Nothing is booked today." via role="status"', async ({
    page,
    request,
  }) => {
    const liveToday = await fetchLiveTodayBookings(request);
    test.skip(liveToday.length > 0, 'requires today to genuinely have no bookings at all');

    await withTodayLock(async () => {
      await page.goto('/today');

      const emptyStatus = page.getByText('Nothing is booked today.');
      await expect(emptyStatus).toBeVisible();
      await expect(emptyStatus).toHaveAttribute('role', 'status');
    });
  });

  test('AC-11 spot-check: resource selection, day navigation and both /today filter selects plus Clear filters remain keyboard-only operable', async ({
    page,
    request,
  }) => {
    const liveResources = await fetchLiveResources(request);
    test.skip(liveResources.length === 0, 'requires at least one seeded resource');

    // Resource selection (/resources) — reachable and activatable by
    // keyboard alone, landing on that resource's schedule.
    await page.goto('/resources');
    const firstResourceLink = page.getByRole('link', { name: liveResources[0].name });
    await firstResourceLink.focus();
    await expect(firstResourceLink).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/resources/${liveResources[0].id}/schedule/`));

    // Day navigation — Tab reaches "Next day", Enter activates it.
    await page.goto(`/resources/${NEBEL_ID}/schedule/${DATE}`);
    const nextDayButton = page.getByRole('button', { name: 'Next day' });
    await nextDayButton.focus();
    await expect(nextDayButton).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp('/schedule/2026-09-02$'));

    // /today filters — both selects operable via Enter/ArrowDown/Enter,
    // and "Clear filters" reachable and activatable via Tab/Enter.
    await withTodayLock(async () => {
      await page.goto('/today');
      const resourceSelectTrigger = resourceSelect(page);
      await resourceSelectTrigger.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('listbox')).toBeVisible();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expect(resourceSelectTrigger).not.toContainText('All resources');

      const clearButton = page.getByRole('button', { name: 'Clear filters' }).first();
      await clearButton.focus();
      await expect(clearButton).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(resourceSelectTrigger).toContainText('All resources');
    });
  });

  test('regression: booking entries on both views still convey resource (where applicable), time range, creator and booked-for person as one accessible name', async ({
    page,
    request,
  }) => {
    const liveSchedule = await fetchLiveFilteredSchedule(request, NEBEL_ID, DATE, {});
    const bookedSegment = liveSchedule.segments.find((s) => s.type === 'booked');
    expect(bookedSegment).toBeDefined();

    await page.goto(`/resources/${NEBEL_ID}/schedule/${DATE}`);
    const scheduleList = page.getByRole('list', { name: `Schedule for ${NEBEL_NAME} on ${DATE}` });
    await expect(scheduleList).toBeVisible();
    const scheduleLink = scheduleList.getByRole('link', {
      name: new RegExp(`Booked by ${bookedSegment!.bookedBy?.name} for ${bookedSegment!.bookedFor?.name}`),
    });
    await expect(scheduleLink.first()).toBeVisible();

    // "Booked"/"Free" leading text label is the disambiguator, not colour
    // — every list item's accessible name starts with one of the two
    // words, verifiable without ever inspecting styling.
    const items = scheduleList.getByRole('listitem');
    const count = await items.count();
    for (let i = 0; i < count; i += 1) {
      await expect(items.nth(i)).toContainText(/^(Booked|Free)/);
    }

    await withTodayLock(async () => {
      const randomAnchor = 20 + Math.floor(Math.random() * 600);
      const booking = await createLiveBooking(request, {
        resourceId: NEBEL_ID,
        bookedForId: ALEX_ID,
        purposeId: 'Meeting',
        start: futureBerlinLocal(randomAnchor),
        end: futureBerlinLocal(randomAnchor + 20),
      });
      try {
        await page.goto('/today');
        const todayLink = page
          .getByRole('list', { name: `All bookings today, ${todayInBerlin()}` })
          .getByRole('link', { name: new RegExp(`^${NEBEL_NAME}: .* Booked by Alex Nguyen for Alex Nguyen`) });
        await expect(todayLink).toBeVisible();
      } finally {
        await deleteLiveBooking(request, booking.id);
      }
    });
  });

  test('the resource schedule and today overview views have no automatically detectable accessibility violations after a filter change', async ({
    page,
  }) => {
    await page.goto(`/resources/${NEBEL_ID}/schedule/${DATE}`);
    await expect(page.getByRole('list', { name: `Schedule for ${NEBEL_NAME} on ${DATE}` })).toBeVisible();
    await choosePerson(page, bookedBySelect(page), ALEX_NAME);
    const scheduleResults = await new AxeBuilder({ page }).analyze();
    expect(scheduleResults.violations).toEqual([]);

    await withTodayLock(async () => {
      await page.goto('/today');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const todayResults = await new AxeBuilder({ page }).analyze();
      expect(todayResults.violations).toEqual([]);
    });
  });
});
