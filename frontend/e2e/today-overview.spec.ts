import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  fetchLiveTodayBookings,
  createLiveBooking,
  deleteLiveBooking,
  type LiveBookingOverviewItem,
} from './support/api';
import { formatBerlinTime, todayInBerlin } from './support/dates';
import { withTodayLock } from './support/todayLock';

/**
 * Issue #23 ACs covered by this file:
 *  - "Routes exist for ... today overview."
 *  - "Today overview has its own entry point in navigation." (the entry
 *    point itself is covered in nav.spec.ts; here we prove the destination
 *    route works once reached.)
 *
 * Issue #28 ACs covered by this file (real chronological listing,
 * replacing the placeholder `{count} booking(s) today.` line the route
 * used to render):
 *  - AC-9: every one of today's bookings across every resource is listed,
 *    each naming its resource, time range, creator ("booked by"), and
 *    subject ("booked for").
 *  - Chronological, scannable ordering — asserted against whatever order
 *    the live `GET /api/bookings` response actually returns, never a
 *    re-derived/assumed order.
 *  - A booking continuing into tomorrow is labelled accordingly (a
 *    booking continuing *from* yesterday cannot be produced against the
 *    live "today" without violating FS-02 R-2 "not in the past" — see
 *    this ticket's report for how that half is covered instead).
 *  - An empty day states nothing is booked, rather than rendering a blank
 *    list (§10).
 *
 * These tests create real bookings for the *actual current* Europe/Berlin
 * calendar day via the live backend (never mocked), then clean them up in
 * a `finally`, per this ticket's own instruction — the shared seed data
 * is dated 2026-09-01 and will not be "today" during normal test runs.
 * `test.describe.configure({ mode: 'serial' })` below keeps this file's
 * OWN tests from racing each other over the same live "today" bucket (a
 * fixture created by one test must not be visible while another test in
 * this file is asserting the empty state).
 *
 * The one exception is the "empty day" test below: it is intentionally
 * network-mocked rather than asserting the live "today" bucket is
 * globally empty. A hard live-emptiness assertion would be racy against
 * ANY other spec file that legitimately creates its own real "today"
 * booking while running concurrently in a different Playwright worker
 * (e.g. `today-overview-filters.spec.ts`, issue #29) — `mode: 'serial'`
 * only protects this file's tests from each other, not from other spec
 * files, and Playwright's default configuration runs different files in
 * parallel. Mocking the empty-day scenario tests exactly what this AC is
 * about (the UI states "Nothing is booked today." when `GET
 * /api/bookings` returns `[]`) without depending on the shared database's
 * global state at all — the same technique this file already uses below
 * for the loading and failure states.
 *
 * Every OTHER test below that creates a real "today" booking, or asserts
 * an exact total count of "today"'s bookings, is wrapped in
 * `withTodayLock` (`support/todayLock.ts`) — a cross-process file lock —
 * so it never runs concurrently with `today-overview-filters.spec.ts`'s
 * own live-"today" tests either. Without it, two spec files running in
 * different Playwright workers could book the same resource for
 * genuinely overlapping times (a real 409 clash) or observe a total
 * count that includes/excludes the other file's in-flight fixture.
 */

const NEBEL_ID = '11111111-1111-1111-1111-111111111111';
const ELBE_ID = '11111111-1111-1111-1111-111111111112';
const PROJECTOR_CART_A_ID = '11111111-1111-1111-1111-111111111113';

const ALEX_ID = '22222222-2222-2222-2222-222222222221';
const BRIGITTE_ID = '22222222-2222-2222-2222-222222222222';
const CHIDI_ID = '22222222-2222-2222-2222-222222222223';

/** Renders a single today-overview `<li>`'s expected accessible text,
 * matching `TodayOverviewRoute`'s own copy exactly, computed independently
 * from the live booking data (never hardcoded). */
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
 * parts via `Intl` — correct across a midnight rollover without any
 * manual hour/day arithmetic, since it is always computed from a real
 * `Date` instant rather than by adding minutes to an already-formatted
 * clock string. */
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

/** Current Europe/Berlin wall-clock hour (0-23), used only to decide
 * whether there is enough runway left today to safely book a slot
 * starting at 23:00 without it already being in the past (FS-02 R-2). */
function currentBerlinHour(): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Berlin',
      hour: '2-digit',
      hour12: false,
    }).format(new Date()),
  );
}

test.describe.configure({ mode: 'serial' });

test.describe('today overview route (/today)', () => {
  test('AC: is reachable directly at /today without selecting a resource first, and its heading identifies today by date', async ({
    page,
    request,
  }) => {
    await withTodayLock(async () => {
      const liveBookings = await fetchLiveTodayBookings(request);
      const today = todayInBerlin();

      await page.goto('/today');

      await expect(
        page.getByRole('heading', { level: 1, name: `Today's bookings — ${today}` }),
      ).toBeVisible();

      if (liveBookings.length === 0) {
        await expect(page.getByText('Nothing is booked today.')).toBeVisible();
      } else {
        const list = page.getByRole('list', { name: `All bookings today, ${today}` });
        await expect(list.getByRole('listitem')).toHaveCount(liveBookings.length);
      }
    });
  });

  test('AC-9: an empty day states nothing is booked today, not a blank list', async ({
    page,
  }) => {
    // Network-mocked (see the module doc comment above for why): this
    // isolates the assertion to "the UI renders the empty-day message
    // when the API returns []" without depending on the shared live
    // "today" bucket being globally empty, which cannot be guaranteed
    // when other spec files may concurrently be creating their own real
    // "today" fixtures in a different worker.
    await page.route('**/api/bookings*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    await page.goto('/today');

    await expect(page.getByText('Nothing is booked today.')).toBeVisible();
    const today = todayInBerlin();
    await expect(page.getByRole('list', { name: `All bookings today, ${today}` })).toHaveCount(0);
  });

  test('AC-9: lists every booking for today across all resources with resource, time range, creator and booked-for person, in the API’s own order', async ({
    page,
    request,
  }) => {
    await withTodayLock(async () => {
      // Randomised anchor/gap (rather than fixed offsets) so this test never
      // collides with itself across parallel workers/repeated runs — it
      // must still land well before midnight, so the range stays inside
      // "the rest of today" (see the currentBerlinHour guard on the
      // continuation-label test below for the same concern).
      const randomAnchor = 20 + Math.floor(Math.random() * 700); // 20–719 minutes from now
      const randomGap = 60 + Math.floor(Math.random() * 90); // 60–149 minutes between A and B

      const bookingA = await createLiveBooking(request, {
        resourceId: NEBEL_ID,
        bookedForId: ALEX_ID,
        purposeId: 'Meeting',
        start: futureBerlinLocal(randomAnchor).local,
        end: futureBerlinLocal(randomAnchor + 20).local,
      });
      const bookingB = await createLiveBooking(request, {
        resourceId: ELBE_ID,
        bookedForId: BRIGITTE_ID,
        purposeId: 'Focus work',
        start: futureBerlinLocal(randomAnchor + randomGap).local,
        end: futureBerlinLocal(randomAnchor + randomGap + 20).local,
      });

      try {
        const liveBookings = await fetchLiveTodayBookings(request);
        expect(liveBookings.length).toBeGreaterThanOrEqual(2);
        const liveIds = liveBookings.map((booking) => booking.id);
        expect(liveIds).toEqual(expect.arrayContaining([bookingA.id, bookingB.id]));

        await page.goto('/today');

        const today = todayInBerlin();
        const list = page.getByRole('list', { name: `All bookings today, ${today}` });
        await expect(list).toBeVisible();

        const items = list.getByRole('listitem');
        await expect(items).toHaveCount(liveBookings.length);

        // Rendered order must match the API's own order exactly — this
        // route does no client-side sort/group of its own.
        for (const [index, booking] of liveBookings.entries()) {
          await expect(items.nth(index)).toHaveText(expectedEntryText(booking));
        }

        // Both fixtures' entries must actually be present and correctly
        // attributed (resource, time range, creator, subject) — not merely
        // that *some* list of the right length rendered.
        const entryA = liveBookings.find((booking) => booking.id === bookingA.id);
        const entryB = liveBookings.find((booking) => booking.id === bookingB.id);
        expect(entryA).toBeDefined();
        expect(entryB).toBeDefined();
        await expect(
          list.getByText(expectedEntryText(entryA as LiveBookingOverviewItem)),
        ).toBeVisible();
        await expect(
          list.getByText(expectedEntryText(entryB as LiveBookingOverviewItem)),
        ).toBeVisible();

        const results = await new AxeBuilder({ page }).include('section').analyze();
        expect(results.violations).toEqual([]);
      } finally {
        await deleteLiveBooking(request, bookingA.id);
        await deleteLiveBooking(request, bookingB.id);
      }
    });
  });

  test('AC-9: a booking continuing into tomorrow is labelled accordingly', async ({
    page,
    request,
  }) => {
    test.skip(
      currentBerlinHour() >= 22,
      'Not enough runway left before Europe/Berlin midnight to book a 23:00 start safely in the future (FS-02 R-2).',
    );

    await withTodayLock(async () => {
      const today = todayInBerlin();
      const tomorrow = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Berlin',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(Date.now() + 26 * 60 * 60 * 1000)); // >24h ahead, always the next calendar day

      // Randomised start/end minutes either side of midnight (rather than a
      // fixed 23:00/00:30) so this test never collides with itself across
      // parallel workers/repeated runs.
      const startMinute = 30 + Math.floor(Math.random() * 30); // :30-:59
      const endMinute = Math.floor(Math.random() * 45); // :00-:44

      const booking = await createLiveBooking(request, {
        resourceId: PROJECTOR_CART_A_ID,
        bookedForId: CHIDI_ID,
        purposeId: 'Training',
        start: `${today}T23:${String(startMinute).padStart(2, '0')}`,
        end: `${tomorrow}T00:${String(endMinute).padStart(2, '0')}`,
      });

      try {
        const liveBookings = await fetchLiveTodayBookings(request);
        const entry = liveBookings.find((b) => b.id === booking.id);
        expect(entry).toBeDefined();
        expect(entry?.continuesIntoNextDay).toBe(true);
        expect(entry?.continuesFromPreviousDay).toBe(false);

        await page.goto('/today');

        const list = page.getByRole('list', { name: `All bookings today, ${today}` });
        await expect(
          list.getByText(expectedEntryText(entry as LiveBookingOverviewItem)),
        ).toBeVisible();
        await expect(
          list.getByText('This booking continues into the next day.', { exact: false }),
        ).toBeVisible();
      } finally {
        await deleteLiveBooking(request, booking.id);
      }
    });
  });

  test('AC: shows a loading state while today’s bookings are being fetched', async ({ page }) => {
    await page.route('**/api/bookings*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue();
    });

    await page.goto('/today');
    await expect(page.getByText("Loading today's bookings…")).toBeVisible();
  });

  test('AC: an unexpected failure fetching today’s bookings is announced with a working retry', async ({
    page,
  }) => {
    let shouldFail = true;
    await page.route('**/api/bookings*', async (route) => {
      if (shouldFail) {
        await route.abort('failed');
        return;
      }
      await route.continue();
    });

    await page.goto('/today');

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(alert).toContainText("Today's bookings could not be loaded.");
    const retry = alert.getByRole('button', { name: 'Retry' });
    await expect(retry).toBeVisible();

    shouldFail = false;
    await retry.click();

    await expect(alert).not.toBeVisible();
    await expect(
      page.getByRole('heading', { level: 1, name: "Today's bookings" }),
    ).toBeVisible();
  });

  test('AC: the today overview view has no automatically detectable accessibility violations', async ({
    page,
  }) => {
    await page.goto('/today');
    await expect(
      page.getByRole('heading', { level: 1, name: "Today's bookings" }),
    ).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
