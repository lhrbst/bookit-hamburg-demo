import { test, expect, type Page } from './support/test';
import AxeBuilder from '@axe-core/playwright';
import {
  fetchLiveTodayBookings,
  fetchLiveFilteredTodayBookings,
  createLiveBooking,
  deleteLiveBooking,
  type LiveBookingOverviewItem,
} from './support/api';
import { formatBerlinTime, todayInBerlin } from './support/dates';
import { withTodayLock } from './support/todayLock';

/**
 * Issue #29 (Task 3.5, Phase 3 — UI views, FS-01 FR-3/§6.4) ACs covered by
 * this file:
 *
 *  - AC-5: filtering by one resource leaves only that resource's
 *    bookings.
 *  - AC-7: combined filters (resource + booked-by/booked-for) apply
 *    additively.
 *  - AC-8: clearing filters restores the unfiltered overview.
 *  - The resource control cannot select more than one resource (§6.4) —
 *    it is a single-select widget by construction, proven by selecting a
 *    second resource and observing the first is replaced, never added.
 *  - An empty filtered result offers a clear-filters affordance, and is
 *    worded distinctly from the genuinely-empty-day message (§10/AC-10).
 *
 * Issue #28's own listing shape/ordering (AC-9) is NOT retested here —
 * only that filtering narrows the already-covered list correctly.
 * Booking creation/cancellation and time zone selection are out of
 * scope, per this ticket.
 *
 * The shared seed data is dated 2026-09-01, so the real "today" is
 * expected to start each test empty; this file creates real bookings for
 * the actual current Europe/Berlin day via the live API and always
 * cleans them up in a `finally`, per this ticket's own instruction.
 * `test.describe.configure({ mode: 'serial' })` (matching
 * `today-overview.spec.ts`'s own convention) keeps this file's tests from
 * racing each other over the same live "today" bucket.
 *
 * `mode: 'serial'` only protects this file's OWN tests from each other —
 * NOT from `today-overview.spec.ts`, which independently creates and
 * asserts against real "today" bookings on the SAME shared resources
 * (Nebel/Elbe) and may run concurrently in a different Playwright worker.
 * Every test below that creates a real "today" booking, or makes an
 * exact-count assertion against the live "today" bucket (via
 * `expectListMatchesLiveFilteredToday`), is wrapped in `withTodayLock`
 * (`support/todayLock.ts`) — a cross-process file lock shared with
 * `today-overview.spec.ts` — so the two files' live-"today" fixtures
 * never overlap in time, eliminating both a real 409 resource clash and
 * a torn total-count read.
 *
 * NOTE on locators: `ResourceFilterSelect`/`PersonFilterSelect`'s
 * underlying React Aria `Select` button carries both an explicit label
 * and an associated `<Label>`, so its accessible name can double up the
 * label text (e.g. "All resources Resource") — the same known,
 * previously-reported/accepted quirk `resource-schedule-filters.spec.ts`
 * already works around for "Booked by"/"Booked for". Locators below
 * match a stable substring via regex, never the exact (duplicated, and
 * therefore fragile) full string.
 */
const NEBEL_ID = '11111111-1111-1111-1111-111111111111';
const ELBE_ID = '11111111-1111-1111-1111-111111111112';
const NEBEL_NAME = 'Nebel';
const ELBE_NAME = 'Elbe';

const ALEX_ID = '22222222-2222-2222-2222-222222222221';
const BRIGITTE_ID = '22222222-2222-2222-2222-222222222222';
const ALEX_NAME = 'Alex Nguyen';

/** Renders a single today-overview `<li>`'s expected accessible text —
 * reimplemented independently from `TodayOverviewRoute`'s own copy,
 * same technique `today-overview.spec.ts#expectedEntryText` already
 * established. */
function expectedEntryText(booking: LiveBookingOverviewItem): string {
  const timeRange = `${formatBerlinTime(booking.start)}–${formatBerlinTime(booking.end)}`;
  let text = `${booking.resource.name}: ${timeRange} · Booked by ${booking.bookedBy.name} for ${booking.bookedFor.name}.`;
  if (booking.continuesFromPreviousDay && booking.continuesIntoNextDay) {
    text += ' This booking continues from the previous day and continues into the next day.';
  } else if (booking.continuesFromPreviousDay) {
    text += ' This booking continues from the previous day.';
  } else if (booking.continuesIntoNextDay) {
    text += ' This booking continues into the next day.';
  }
  return text;
}

/** An absolute instant `minutesFromNow` in the future, resolved to its
 * Europe/Berlin calendar day (`YYYY-MM-DD`) and wall-clock time (`HH:mm`)
 * parts via `Intl` — same helper `today-overview.spec.ts` uses, so a
 * fixture booked here is always safely "later today, not in the past"
 * (FS-02 R-2), reimplemented locally to keep this file self-contained. */
function futureBerlinLocal(minutesFromNow: number): { date: string; time: string; local: string } {
  const instant = new Date(Date.now() + minutesFromNow * 60_000);
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(instant);
  return { date, time, local: `${date}T${time}` };
}

function todayList(page: Page) {
  return page.getByRole('list', { name: `All bookings today, ${todayInBerlin()}` });
}

/** The "Resource" filter's trigger button — see the locator note above. */
function resourceSelect(page: Page) {
  return page.getByRole('button', { name: /Resource/ });
}

/** The "Booked by" filter's trigger button — see the locator note above. */
function bookedBySelect(page: Page) {
  return page.getByRole('button', { name: /Booked by/ });
}

/** The "Booked for" filter's trigger button — see the locator note above. */
function bookedForSelect(page: Page) {
  return page.getByRole('button', { name: /Booked for/ });
}

async function chooseOption(
  select: ReturnType<typeof resourceSelect>,
  page: Page,
  optionName: string,
) {
  await select.click();
  await page.getByRole('option', { name: optionName, exact: true }).click();
}

/** Asserts the rendered `<ul>` matches the live, filtered `GET
 * /api/bookings` response exactly (in order) for this filter
 * combination — never a re-derived/assumed shape, mirroring
 * `resource-schedule-filters.spec.ts`'s
 * `expectListMatchesLiveFilteredSchedule`. */
async function expectListMatchesLiveFilteredToday(
  page: Page,
  request: Parameters<typeof fetchLiveFilteredTodayBookings>[0],
  filters: { resourceId?: string; bookedById?: string; bookedForId?: string },
) {
  const liveBookings = await fetchLiveFilteredTodayBookings(request, filters);
  const list = todayList(page);
  if (liveBookings.length === 0) {
    await expect(list).toHaveCount(0);
    return liveBookings;
  }
  await expect(list).toBeVisible();
  const items = list.getByRole('listitem');
  await expect(items).toHaveCount(liveBookings.length);
  for (const [index, booking] of liveBookings.entries()) {
    await expect(items.nth(index)).toHaveText(expectedEntryText(booking));
  }
  return liveBookings;
}

test.describe.configure({ mode: 'serial' });

test.describe('today overview filters (issue #29)', () => {
  test('unfiltered baseline: the resource filter offers "All resources" plus every seeded resource, and no filter is active', async ({
    page,
  }) => {
    await page.goto('/today');

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(resourceSelect(page)).toContainText('All resources');
    await expect(bookedBySelect(page)).toContainText('Anyone');
    await expect(bookedForSelect(page)).toContainText('Anyone');

    await expect(
      page.getByText('Showing all bookings today (no filters applied).'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear filters' })).toBeDisabled();

    await resourceSelect(page).click();
    await expect(page.getByRole('option', { name: 'All resources', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: NEBEL_NAME, exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: ELBE_NAME, exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('AC-5: filtering by one resource leaves only that resource\'s bookings', async ({
    page,
    request,
  }) => {
    await withTodayLock(async () => {
      const randomAnchor = 20 + Math.floor(Math.random() * 600);
      const nebelBooking = await createLiveBooking(request, {
        resourceId: NEBEL_ID,
        bookedForId: ALEX_ID,
        purposeId: 'Meeting',
        start: futureBerlinLocal(randomAnchor).local,
        end: futureBerlinLocal(randomAnchor + 20).local,
      });
      const elbeBooking = await createLiveBooking(request, {
        resourceId: ELBE_ID,
        bookedForId: BRIGITTE_ID,
        purposeId: 'Focus work',
        start: futureBerlinLocal(randomAnchor + 60).local,
        end: futureBerlinLocal(randomAnchor + 80).local,
      });

      try {
        const liveBookings = await fetchLiveTodayBookings(request);
        expect(liveBookings.map((b) => b.id)).toEqual(
          expect.arrayContaining([nebelBooking.id, elbeBooking.id]),
        );

        await page.goto('/today');
        await expect(todayList(page).getByRole('listitem').first()).toBeVisible();

        await chooseOption(resourceSelect(page), page, NEBEL_NAME);

        const filtered = await expectListMatchesLiveFilteredToday(page, request, {
          resourceId: NEBEL_ID,
        });
        expect(filtered.length).toBeGreaterThan(0);
        expect(filtered.every((b) => b.resource.id === NEBEL_ID)).toBe(true);
        expect(filtered.some((b) => b.id === elbeBooking.id)).toBe(false);
        expect(filtered.some((b) => b.id === nebelBooking.id)).toBe(true);

        await expect(page.getByText(`Showing bookings for ${NEBEL_NAME}.`)).toBeVisible();
        await expect(page.getByRole('button', { name: 'Clear filters' })).toBeEnabled();
      } finally {
        await deleteLiveBooking(request, nebelBooking.id);
        await deleteLiveBooking(request, elbeBooking.id);
      }
    });
  });

  test('the resource control cannot select more than one resource: choosing a second resource replaces, never adds to, the first', async ({
    page,
    request,
  }) => {
    await withTodayLock(async () => {
      await page.goto('/today');
      await expect(resourceSelect(page)).toBeVisible();

      await chooseOption(resourceSelect(page), page, NEBEL_NAME);
      await expect(resourceSelect(page)).toContainText(NEBEL_NAME);
      await expect(page.getByText(`Showing bookings for ${NEBEL_NAME}.`)).toBeVisible();

      await chooseOption(resourceSelect(page), page, ELBE_NAME);
      await expect(resourceSelect(page)).toContainText(ELBE_NAME);
      await expect(resourceSelect(page)).not.toContainText(NEBEL_NAME);
      await expect(page.getByText(`Showing bookings for ${ELBE_NAME}.`)).toBeVisible();
      await expect(page.getByText(`Showing bookings for ${NEBEL_NAME}.`)).toHaveCount(0);

      // The underlying widget itself only ever exposes a single trigger
      // button naming the (one) current selection, not a multi-value
      // widget — confirming there is exactly one resource selection
      // surfaced to assistive technology at any time.
      await expect(page.getByRole('button', { name: /Resource/ })).toHaveCount(1);

      await expectListMatchesLiveFilteredToday(page, request, { resourceId: ELBE_ID });
    });
  });

  test('AC-7: resource and "booked for" filters combine additively', async ({ page, request }) => {
    await withTodayLock(async () => {
      // NOTE: `createLiveBooking` always attributes the booking to whatever
      // person the backend's `GET /api/me` currently reports as "current
      // person" (Alex Nguyen in this environment) — `bookedForId` is the
      // only per-booking party this fixture helper can vary. This test
      // therefore proves the additive AC-7 combination using
      // resource + "booked for" (both freely controllable), rather than
      // "booked by" (which every fixture booking shares regardless of
      // input) — a genuine constraint of the live API, not a shortcut.
      const randomAnchor = 20 + Math.floor(Math.random() * 600);
      const nebelForAlex = await createLiveBooking(request, {
        resourceId: NEBEL_ID,
        bookedForId: ALEX_ID,
        purposeId: 'Meeting',
        start: futureBerlinLocal(randomAnchor).local,
        end: futureBerlinLocal(randomAnchor + 20).local,
      });
      const nebelForBrigitte = await createLiveBooking(request, {
        resourceId: NEBEL_ID,
        bookedForId: BRIGITTE_ID,
        purposeId: 'Focus work',
        start: futureBerlinLocal(randomAnchor + 60).local,
        end: futureBerlinLocal(randomAnchor + 80).local,
      });

      try {
        await page.goto('/today');
        await expect(todayList(page).getByRole('listitem').first()).toBeVisible();

        await chooseOption(resourceSelect(page), page, NEBEL_NAME);
        await chooseOption(bookedForSelect(page), page, ALEX_NAME);

        const filtered = await expectListMatchesLiveFilteredToday(page, request, {
          resourceId: NEBEL_ID,
          bookedForId: ALEX_ID,
        });
        expect(filtered.length).toBeGreaterThan(0);
        expect(
          filtered.every((b) => b.resource.id === NEBEL_ID && b.bookedFor.id === ALEX_ID),
        ).toBe(true);
        expect(filtered.some((b) => b.id === nebelForBrigitte.id)).toBe(false);
        expect(filtered.some((b) => b.id === nebelForAlex.id)).toBe(true);

        const summary = page.getByText(/Showing bookings/);
        await expect(summary).toHaveText(
          `Showing bookings for ${NEBEL_NAME} booked for ${ALEX_NAME}.`,
        );
      } finally {
        await deleteLiveBooking(request, nebelForAlex.id);
        await deleteLiveBooking(request, nebelForBrigitte.id);
      }
    });
  });

  test('AC-8: clearing filters restores the unfiltered overview and resets every control', async ({
    page,
    request,
  }) => {
    await withTodayLock(async () => {
      const randomAnchor = 20 + Math.floor(Math.random() * 600);
      const booking = await createLiveBooking(request, {
        resourceId: NEBEL_ID,
        bookedForId: ALEX_ID,
        purposeId: 'Meeting',
        start: futureBerlinLocal(randomAnchor).local,
        end: futureBerlinLocal(randomAnchor + 20).local,
      });

      try {
        await page.goto('/today');
        await expect(todayList(page).getByRole('listitem').first()).toBeVisible();

        await chooseOption(resourceSelect(page), page, NEBEL_NAME);
        await chooseOption(bookedBySelect(page), page, ALEX_NAME);
        await expectListMatchesLiveFilteredToday(page, request, {
          resourceId: NEBEL_ID,
          bookedById: ALEX_ID,
        });

        const clearButton = page.getByRole('button', { name: 'Clear filters' }).first();
        await expect(clearButton).toBeEnabled();
        await clearButton.click();

        await expectListMatchesLiveFilteredToday(page, request, {});
        await expect(
          page.getByText('Showing all bookings today (no filters applied).'),
        ).toBeVisible();
        await expect(resourceSelect(page)).toContainText('All resources');
        await expect(bookedBySelect(page)).toContainText('Anyone');
        await expect(bookedForSelect(page)).toContainText('Anyone');
        await expect(page.getByRole('button', { name: 'Clear filters' })).toBeDisabled();
      } finally {
        await deleteLiveBooking(request, booking.id);
      }
    });
  });

  test('an empty filtered result states no bookings match and offers a clear-filters affordance, distinct from the genuinely-empty-day message', async ({
    page,
    request,
  }) => {
    await withTodayLock(async () => {
      const randomAnchor = 20 + Math.floor(Math.random() * 600);
      // A real booking for Nebel exists today, but never for Elbe — so
      // filtering by Elbe is guaranteed to narrow a non-empty day down to
      // zero results (never a "day genuinely has nothing" coincidence).
      const booking = await createLiveBooking(request, {
        resourceId: NEBEL_ID,
        bookedForId: ALEX_ID,
        purposeId: 'Meeting',
        start: futureBerlinLocal(randomAnchor).local,
        end: futureBerlinLocal(randomAnchor + 20).local,
      });

      try {
        const liveBookings = await fetchLiveTodayBookings(request);
        expect(liveBookings.some((b) => b.id === booking.id)).toBe(true);
        expect(liveBookings.some((b) => b.resource.id === ELBE_ID)).toBe(false);

        await page.goto('/today');
        await expect(todayList(page).getByRole('listitem').first()).toBeVisible();

        await chooseOption(resourceSelect(page), page, ELBE_NAME);

        await expectListMatchesLiveFilteredToday(page, request, { resourceId: ELBE_ID });
        await expect(page.getByText('No bookings match the current filters.')).toBeVisible();
        // Distinct from issue #28's genuinely-empty-day message, which must
        // NOT appear here — a filtered-empty result is a different state.
        await expect(page.getByText('Nothing is booked today.')).toHaveCount(0);

        const emptyStateClearButton = page.getByRole('button', { name: 'Clear filters' }).last();
        await expect(emptyStateClearButton).toBeEnabled();
        await emptyStateClearButton.click();

        await expectListMatchesLiveFilteredToday(page, request, {});
        await expect(
          page.getByText('Showing all bookings today (no filters applied).'),
        ).toBeVisible();
        await expect(resourceSelect(page)).toContainText('All resources');
        await expect(page.getByText('No bookings match the current filters.')).toHaveCount(0);
      } finally {
        await deleteLiveBooking(request, booking.id);
      }
    });
  });

  test('keyboard operability: the resource filter can be selected using only the keyboard', async ({
    page,
    request,
  }) => {
    await withTodayLock(async () => {
      await page.goto('/today');
      await expect(resourceSelect(page)).toBeVisible();

      const select = resourceSelect(page);
      await select.focus();
      await expect(select).toBeFocused();

      // Open with Enter, move past "All resources" (the first,
      // already-selected option) to the first seeded resource with
      // ArrowDown, and confirm with Enter — no mouse interaction anywhere
      // in this test.
      await page.keyboard.press('Enter');
      await expect(page.getByRole('listbox')).toBeVisible();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');

      await expect(select).toBeFocused();
      await expect(select).not.toContainText('All resources');
      await expect(page.getByText(/^Showing bookings for /)).toBeVisible();

      // Escape closes the popover WITHOUT changing the selection.
      const currentSelection = await select.textContent();
      await select.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('listbox')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('listbox')).toHaveCount(0);
      await expect(select).toHaveText(currentSelection ?? '');

      await expectListMatchesLiveFilteredToday(page, request, {});
    });
  });

  test('the today overview view with a resource filter selected has no automatically detectable accessibility violations', async ({
    page,
    request,
  }) => {
    await withTodayLock(async () => {
      await page.goto('/today');
      await expect(resourceSelect(page)).toBeVisible();

      await chooseOption(resourceSelect(page), page, NEBEL_NAME);
      await expectListMatchesLiveFilteredToday(page, request, { resourceId: NEBEL_ID });

      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });
  });
});
