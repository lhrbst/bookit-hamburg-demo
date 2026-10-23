import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  fetchLiveScheduleForDate,
  fetchLiveTodayBookings,
  createLiveBooking,
  deleteLiveBooking,
  type LiveScheduleSegment,
} from './support/api';
import { formatBerlinTime, formatBerlinDateTime } from './support/dates';
import { withTodayLock } from './support/todayLock';

/**
 * Issue #44 (Task 3.5, Phase 3 — UI) ACs covered by this file — wiring the
 * FS-01 read views (resource schedule, today overview) to the FS-02
 * write/detail views, and proving a mutation's cache invalidation
 * actually refetches from the server rather than patching the cache
 * optimistically:
 *
 * | AC | User journey | Observable outcome | Accessibility check |
 * |---|---|---|---|
 * | A free period leads to the booking form with its resource pre-selected | click a "Book this free slot, HH:mm–HH:mm" link on a resource schedule | lands on `/resources/:resourceId/book`, heading names the resource, Start/End pre-filled to the segment's Berlin-local range and still editable | link reached and activated by keyboard alone |
 * | Free-slot links are distinguishable | a schedule day with 2+ free segments | each link's accessible name states a different time range | `getByRole('link')` names compared, no duplicates |
 * | A booking entry in a FS-01 view opens its detail | click a today-overview entry | navigates to `/bookings/:id`, detail `<dl>` matches the entry's resource/time/booked-by/booked-for/purpose | link reached and activated by keyboard alone |
 * | Returning to the schedule after creating shows it without a manual reload (AC-2) | create via a free-slot link, then follow the confirmation's "View schedule" link (SPA, no `page.reload`/`page.goto`) | the new segment renders "Booked ..." instead of "Free ..." | axe scan of the resulting schedule view |
 * | Returning to the schedule after cancelling shows the period free (AC-9) | cancel via the detail page, then reach the schedule again through the persistent nav (SPA) | the segment renders "Free ..." again, the booking gone | axe scan of the resulting schedule view |
 * | Refreshed data comes from the server, not optimistic local mutation | both round-trip flows above | a real `GET` to the schedule endpoint is observed AFTER the mutation and BEFORE the updated segment is asserted, carrying the server's own updated payload | (network assertion, not an accessibility check) |
 *
 * Out of scope (see this ticket's hand-off notes, confirmed against the
 * live backend before writing this file):
 *  - The booking form's own field validation and the cancel dialog's
 *    confirm/dismiss mechanics — already covered by issues #40/#43.
 *
 * Issue #55 (gap-fill on top of #44/#54) closes the one gap noted above:
 * once the backend started returning a booking `id` on every booked
 * segment (#54), `ResourceScheduleRoute` wraps each booked segment's
 * whole descriptive sentence in a `Link` to `/bookings/:id`, exactly
 * mirroring the free-segment/today-overview pattern already covered
 * above. See the `resource schedule → booking detail wiring (issue #55)`
 * describe block below.
 */

const NEBEL_ID = '11111111-1111-1111-1111-111111111111';
const ELBE_ID = '11111111-1111-1111-1111-111111111112';
const PROJECTOR_CART_A_ID = '11111111-1111-1111-1111-111111111113';
const ALEX_ID = '22222222-2222-2222-2222-222222222221';

/** Formats a segment's own Berlin-local time range, matching
 * `ResourceScheduleRoute`'s free-slot link accessible name exactly
 * ("Book this free slot, HH:mm–HH:mm"). */
function segmentTimeRange(segment: LiveScheduleSegment): string {
  return `${formatBerlinTime(segment.start)}–${formatBerlinTime(segment.end)}`;
}

/** A far-future `YYYY-MM-DD` Europe/Berlin calendar day, randomised so
 * parallel runs/workers never collide on the same day — offset well
 * beyond every other spec file's own far-future fixture range (the
 * furthest of which anchors around ~650 days) so this file's whole-day
 * "currently free" assumption below is never invalidated by another
 * spec's fixture landing on the same day. */
function farFutureBerlinDate(): string {
  const randomOffsetDays = 900 + Math.floor(Math.random() * 300);
  const instant = new Date(Date.now() + randomOffsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** An absolute instant `minutesFromNow` in the future, resolved to its
 * Europe/Berlin calendar day/time parts — mirrors `today-overview.spec.ts`'s
 * own `futureBerlinLocal` helper (re-implemented here rather than shared,
 * per that file's own reasoning: computed from a real instant, never by
 * string-adding minutes to an already-formatted clock string, so a
 * midnight rollover is handled correctly without extra logic). */
function futureBerlinLocal(minutesFromNow: number): { date: string; local: string } {
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
  return { date, local: `${date}T${time}` };
}

function freeSlotLink(page: Page, timeRange: string) {
  return page.getByRole('link', { name: `Book this free slot, ${timeRange}`, exact: true });
}

test.describe('resource schedule → booking form wiring (issue #44)', () => {
  test('AC: a free period leads to the booking form with that resource pre-selected and its own time range pre-filled, still editable', async ({
    page,
    request,
  }) => {
    const liveSchedule = await fetchLiveScheduleForDate(request, ELBE_ID, '2026-09-01');
    const freeSegments = liveSchedule.segments.filter(
      (segment): segment is LiveScheduleSegment & { type: 'free' } => segment.type === 'free',
    );
    // A "middle" free segment (bounded by real bookings on both sides,
    // not the whole day) is the more meaningful case — proves the link
    // carries THAT segment's own start/end, not just "today, all day".
    const middleFreeSegment = freeSegments[1];
    test.skip(middleFreeSegment === undefined, 'requires a bounded free segment in the seed schedule');
    const timeRange = segmentTimeRange(middleFreeSegment);

    await page.goto(`/resources/${ELBE_ID}/schedule/2026-09-01`);

    const link = freeSlotLink(page, timeRange);
    await expect(link).toBeVisible();

    // Keyboard reachability: tab forward from the top of the document
    // until this specific link is focused (bounded, since a native
    // page's tab order is not a fixed constant this test should assume).
    let reached = false;
    for (let i = 0; i < 60; i += 1) {
      if (await link.evaluate((el) => el === document.activeElement)) {
        reached = true;
        break;
      }
      await page.keyboard.press('Tab');
    }
    expect(reached).toBe(true);

    // Keyboard activation: Enter on a focused link navigates, exactly as
    // a mouse click would — never asserted via `.click()` alone.
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(`/resources/${ELBE_ID}/book`);
    await expect(
      page.getByRole('heading', { level: 1, name: `Book ${liveSchedule.resource.name}` }),
    ).toBeVisible();

    const [expectedStartLocal, expectedEndLocal] = [
      berlinInstantToLocalInputValue(middleFreeSegment.start),
      berlinInstantToLocalInputValue(middleFreeSegment.end),
    ];

    const startInput = page.getByLabel('Start');
    const endInput = page.getByLabel('End');
    await expect(startInput).toHaveValue(expectedStartLocal);
    await expect(endInput).toHaveValue(expectedEndLocal);

    // Pre-filled, never locked: the inputs must not be `disabled` or
    // `readonly`, and must actually accept a new value when edited.
    await expect(startInput).not.toBeDisabled();
    await expect(startInput).not.toHaveAttribute('readonly', '');
    await expect(endInput).not.toBeDisabled();
    await expect(endInput).not.toHaveAttribute('readonly', '');

    await startInput.fill('2026-09-01T06:00');
    await expect(startInput).toHaveValue('2026-09-01T06:00');

    const results = await new AxeBuilder({ page }).include('section').analyze();
    expect(results.violations).toEqual([]);
  });

  test('AC: multiple free segments in the same schedule carry distinguishable accessible names for their booking links', async ({
    page,
    request,
  }) => {
    const liveSchedule = await fetchLiveScheduleForDate(request, ELBE_ID, '2026-09-01');
    const freeSegments = liveSchedule.segments.filter(
      (segment): segment is LiveScheduleSegment & { type: 'free' } => segment.type === 'free',
    );
    test.skip(freeSegments.length < 2, 'requires at least two free segments in the seed schedule');

    await page.goto(`/resources/${ELBE_ID}/schedule/2026-09-01`);

    const names = new Set<string>();
    for (const segment of freeSegments) {
      const timeRange = segmentTimeRange(segment);
      const link = freeSlotLink(page, timeRange);
      await expect(link).toBeVisible();
      names.add(`Book this free slot, ${timeRange}`);
    }
    // As many distinct accessible names as free segments — a screen
    // reader user tabbing through the list hears a different name for
    // each, never an identical generic "Book" repeated.
    expect(names.size).toBe(freeSegments.length);
  });
});

test.describe('today overview → booking detail wiring (issue #44)', () => {
  test('AC: a booking entry in the today overview opens its own booking detail, reached and activated by keyboard alone', async ({
    page,
    request,
  }) => {
    await withTodayLock(async () => {
      const randomAnchor = 20 + Math.floor(Math.random() * 600);
      const { local: start } = futureBerlinLocal(randomAnchor);
      const { local: end } = futureBerlinLocal(randomAnchor + 30);

      const booking = await createLiveBooking(request, {
        resourceId: NEBEL_ID,
        bookedForId: ALEX_ID,
        purposeId: 'Interview',
        start,
        end,
      });

      try {
        await page.goto('/today');

        const liveToday = await fetchLiveTodayBookings(request);
        const entry = liveToday.find((item) => item.id === booking.id);
        expect(entry).toBeDefined();
        const timeRange = `${formatBerlinTime(entry!.start)}–${formatBerlinTime(entry!.end)}`;
        const entryName = `${entry!.resource.name}: ${timeRange} · Booked by ${entry!.bookedBy.name} for ${entry!.bookedFor.name}.`;

        const link = page.getByRole('link', { name: entryName, exact: true });
        await expect(link).toBeVisible();

        let reached = false;
        for (let i = 0; i < 80; i += 1) {
          if (await link.evaluate((el) => el === document.activeElement)) {
            reached = true;
            break;
          }
          await page.keyboard.press('Tab');
        }
        expect(reached).toBe(true);
        await page.keyboard.press('Enter');

        await expect(page).toHaveURL(`/bookings/${booking.id}`);
        await expect(page.getByRole('heading', { level: 1, name: 'Booking detail' })).toBeVisible();

        const dateTimeText = `${formatBerlinDateTime(entry!.start)} – ${formatBerlinDateTime(entry!.end)}`;
        // Every one of the five FS-02 facts this entry claims must match
        // the detail page's own `<dl>` — resource, date/time range,
        // booked-by, booked-for (purpose is not asserted here since the
        // today-overview entry itself does not state it).
        await expect(page.locator('dl')).toContainText(entry!.resource.name);
        await expect(page.locator('dl')).toContainText(dateTimeText);
        await expect(page.locator('dl')).toContainText(entry!.bookedBy.name);
        await expect(page.locator('dl')).toContainText(entry!.bookedFor.name);
      } finally {
        await deleteLiveBooking(request, booking.id);
      }
    });
  });
});

/** Renders a booked segment's expected accessible link name, matching
 * `ResourceScheduleRoute`'s own copy exactly (mirrors
 * `resource-schedule-segments.spec.ts`'s `expectedSegmentText` for the
 * booked branch) — computed independently from the live segment data,
 * never hardcoded, since issue #55 wraps this exact sentence in the
 * `Link` to `/bookings/:id`. */
function bookedSegmentLinkName(segment: LiveScheduleSegment): string {
  const timeRange = segmentTimeRange(segment);
  let text = `Booked ${timeRange} · Booked by ${segment.bookedBy?.name} for ${segment.bookedFor?.name}.`;
  if (segment.continuesFromPreviousDay && segment.continuesIntoNextDay) {
    text += ' This booking continues from the previous day and continues into the next day.';
  } else if (segment.continuesFromPreviousDay) {
    text += ' This booking continues from the previous day.';
  } else if (segment.continuesIntoNextDay) {
    text += ' This booking continues into the next day.';
  }
  return text;
}

test.describe('resource schedule → booking detail wiring (issue #55)', () => {
  test('AC: every booked segment on the resource schedule is a link to its own booking detail view, with an accessible name that identifies the specific booking and distinguishes it from an adjacent booking', async ({
    page,
    request,
  }) => {
    const liveSchedule = await fetchLiveScheduleForDate(request, NEBEL_ID, '2026-09-01');
    const bookedSegments = liveSchedule.segments.filter(
      (segment): segment is LiveScheduleSegment & { type: 'booked'; id: string } =>
        segment.type === 'booked' && segment.id !== undefined,
    );
    // The seeded 2026-09-01 schedule for Nebel carries several
    // back-to-back bookings (FS-03 §10: never merged) — exactly the case
    // where a screen-reader user tabbing through the list most needs a
    // distinguishing accessible name per entry, not merely "a link".
    test.skip(bookedSegments.length < 2, 'requires at least two booked segments in the seed schedule');

    await page.goto(`/resources/${NEBEL_ID}/schedule/2026-09-01`);

    const names = new Set<string>();
    for (const segment of bookedSegments) {
      const expectedName = bookedSegmentLinkName(segment);
      const link = page.getByRole('link', { name: expectedName, exact: true });
      await expect(link).toBeVisible();
      // The link's own destination must be that exact booking's id — not
      // just "some detail page" — proven via its rendered `href`, ground
      // truth for which comes from the live schedule endpoint, never
      // assumed.
      await expect(link).toHaveAttribute('href', `/bookings/${segment.id}`);
      names.add(expectedName);
    }
    // As many distinct accessible names as booked segments — proving two
    // adjacent back-to-back bookings (e.g. 09:00–10:00 and 10:00–11:00)
    // are never announced identically.
    expect(names.size).toBe(bookedSegments.length);

    // No regression to the free-segment affordance established by issue
    // #44: it must still coexist, unchanged, alongside the new booked
    // links on the very same list.
    const freeSegment = liveSchedule.segments.find((segment) => segment.type === 'free');
    if (freeSegment !== undefined) {
      await expect(freeSlotLink(page, segmentTimeRange(freeSegment))).toBeVisible();
    }

    // Automated accessibility scan (AC: "no automatically detectable
    // accessibility violations") of this exact view, now rendering both
    // booked links and free links side by side.
    const results = await new AxeBuilder({ page }).include('section').analyze();
    expect(results.violations).toEqual([]);
  });

  test('AC: clicking a specific booked segment link navigates to that exact booking’s own detail view', async ({
    page,
    request,
  }) => {
    const liveSchedule = await fetchLiveScheduleForDate(request, NEBEL_ID, '2026-09-01');
    const bookedSegments = liveSchedule.segments.filter(
      (segment): segment is LiveScheduleSegment & { type: 'booked'; id: string } =>
        segment.type === 'booked' && segment.id !== undefined,
    );
    test.skip(bookedSegments.length < 2, 'requires at least two booked segments in the seed schedule');
    // The SECOND booked segment specifically — proving this is not
    // accidentally always linking to the first/only booking on the page.
    const targetSegment = bookedSegments[1];

    await page.goto(`/resources/${NEBEL_ID}/schedule/2026-09-01`);

    await page.getByRole('link', { name: bookedSegmentLinkName(targetSegment), exact: true }).click();

    await expect(page).toHaveURL(`/bookings/${targetSegment.id}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Booking detail' })).toBeVisible();

    const dateTimeText = `${formatBerlinDateTime(targetSegment.start)} – ${formatBerlinDateTime(targetSegment.end)}`;
    // The detail view that loads must show THAT booking's own facts, not
    // e.g. the first booked segment's — resource, date/time range,
    // booked-by, booked-for.
    await expect(page.locator('dl')).toContainText(liveSchedule.resource.name);
    await expect(page.locator('dl')).toContainText(dateTimeText);
    await expect(page.locator('dl')).toContainText(targetSegment.bookedBy!.name);
    await expect(page.locator('dl')).toContainText(targetSegment.bookedFor!.name);
  });

  test('AC: a booked segment link is reached and activated by keyboard alone (Tab, Enter), navigating to its own booking detail', async ({
    page,
    request,
  }) => {
    const liveSchedule = await fetchLiveScheduleForDate(request, NEBEL_ID, '2026-09-01');
    const bookedSegments = liveSchedule.segments.filter(
      (segment): segment is LiveScheduleSegment & { type: 'booked'; id: string } =>
        segment.type === 'booked' && segment.id !== undefined,
    );
    test.skip(bookedSegments.length < 1, 'requires a booked segment in the seed schedule');
    const targetSegment = bookedSegments[0];

    await page.goto(`/resources/${NEBEL_ID}/schedule/2026-09-01`);

    const link = page.getByRole('link', { name: bookedSegmentLinkName(targetSegment), exact: true });
    await expect(link).toBeVisible();

    let reached = false;
    for (let i = 0; i < 80; i += 1) {
      if (await link.evaluate((el) => el === document.activeElement)) {
        reached = true;
        break;
      }
      await page.keyboard.press('Tab');
    }
    expect(reached).toBe(true);
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(`/bookings/${targetSegment.id}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Booking detail' })).toBeVisible();

    const dateTimeText = `${formatBerlinDateTime(targetSegment.start)} – ${formatBerlinDateTime(targetSegment.end)}`;
    await expect(page.locator('dl')).toContainText(liveSchedule.resource.name);
    await expect(page.locator('dl')).toContainText(dateTimeText);
    await expect(page.locator('dl')).toContainText(targetSegment.bookedBy!.name);
    await expect(page.locator('dl')).toContainText(targetSegment.bookedFor!.name);
  });
});

test.describe('create/cancel round trips refetch FS-01 views from the server (issue #44)', () => {
  test('AC-2: returning to the schedule after creating a booking (via a free-slot link, SPA navigation only) shows it booked, refetched from the server', async ({
    page,
    request,
  }) => {
    const date = farFutureBerlinDate();
    const liveSchedule = await fetchLiveScheduleForDate(request, NEBEL_ID, date);
    expect(liveSchedule.segments).toHaveLength(1);
    expect(liveSchedule.segments[0].type).toBe('free');

    const wholeDayFree = liveSchedule.segments[0];
    const wholeDayTimeRange = segmentTimeRange(wholeDayFree);

    let createdBookingId: string | undefined;

    try {
      await page.goto(`/resources/${NEBEL_ID}/schedule/${date}`);
      await freeSlotLink(page, wholeDayTimeRange).click();

      await expect(page).toHaveURL(`/resources/${NEBEL_ID}/book`);

      // Adjust the pre-filled (whole-day) range down to a clean one-hour
      // slot before submitting — proving editability again in passing,
      // and giving this test an unambiguous booked/free split to assert
      // on the way back.
      await page.getByLabel('Start').fill(`${date}T10:00`);
      await page.getByLabel('End').fill(`${date}T11:00`);
      await chooseByKeyboard(page, bookedForButton(page), 'Alex Nguyen');
      await chooseByKeyboard(page, purposeButton(page), 'Meeting');

      const [createResponse] = await Promise.all([
        page.waitForResponse(
          (res) => res.url().endsWith('/api/bookings') && res.request().method() === 'POST',
        ),
        page.getByRole('button', { name: 'Book this resource' }).click(),
      ]);
      expect(createResponse.status()).toBe(201);
      const created = (await createResponse.json()) as { booking: { id: string } };
      createdBookingId = created.booking.id;

      await expect(page).toHaveURL(`/bookings/${created.booking.id}/confirmation`);

      // The real regression assertion: navigating back to the schedule
      // through the confirmation's OWN in-app link (a React Router
      // `<Link>`, never `page.reload()`/`page.goto()`) must trigger a
      // genuine network refetch of the schedule endpoint — proving the
      // updated segment comes from the server's own recomputation, not
      // an optimistic local patch of the query cache.
      const scheduleRefetch = page.waitForResponse(
        (res) =>
          res.url().includes(`/api/resources/${NEBEL_ID}/schedule`) && res.request().method() === 'GET',
      );
      await page.getByRole('link', { name: `View Nebel’s schedule` }).click();
      const refetchResponse = await scheduleRefetch;
      expect(refetchResponse.status()).toBe(200);
      const refetchedBody = (await refetchResponse.json()) as {
        segments: LiveScheduleSegment[];
      };

      await expect(page).toHaveURL(`/resources/${NEBEL_ID}/schedule/${date}`);

      const bookedSegment = refetchedBody.segments.find((segment) => segment.type === 'booked');
      expect(bookedSegment).toBeDefined();

      const bookedTimeRange = segmentTimeRange(bookedSegment as LiveScheduleSegment);
      await expect(
        page.getByText(`Booked ${bookedTimeRange} · Booked by Alex Nguyen for Alex Nguyen.`),
      ).toBeVisible();
      // The whole-day "Free ..." entry from before creation must be gone
      // — replaced by the split free/booked segments the server now
      // returns.
      await expect(page.getByText(`Free ${wholeDayTimeRange}.`)).toHaveCount(0);

      const results = await new AxeBuilder({ page }).include('section').analyze();
      expect(results.violations).toEqual([]);
    } finally {
      if (createdBookingId !== undefined) {
        await deleteLiveBooking(request, createdBookingId);
      }
    }
  });

  test('AC-9: returning to a resource schedule after cancelling a booking (via the persistent nav, SPA navigation only) shows the period free again, refetched from the server', async ({
    page,
    request,
  }) => {
    await withTodayLock(async () => {
      const randomAnchor = 20 + Math.floor(Math.random() * 600);
      const { local: start, date: today } = futureBerlinLocal(randomAnchor);
      const { local: end } = futureBerlinLocal(randomAnchor + 30);

      const booking = await createLiveBooking(request, {
        resourceId: PROJECTOR_CART_A_ID,
        bookedForId: ALEX_ID,
        purposeId: 'Maintenance',
        start,
        end,
      });

      try {
        // Confirm ground truth: the resource's schedule for today
        // currently shows this booking (server-side), before we touch
        // anything through the UI.
        const beforeCancel = await fetchLiveScheduleForDate(request, PROJECTOR_CART_A_ID, today);
        expect(beforeCancel.segments.some((segment) => segment.type === 'booked')).toBe(true);

        // Reach the booking's detail page via `/today` — an equally
        // valid FS-01 entry point (a resource schedule's booked segments
        // link to their own detail view too, as of issue #55, covered by
        // its own describe block above; this test's own scope is the
        // create/cancel refetch round trip, not which FS-01 view was
        // used to get there).
        await page.goto('/today');
        const liveToday = await fetchLiveTodayBookings(request);
        const entry = liveToday.find((item) => item.id === booking.id);
        expect(entry).toBeDefined();
        const timeRange = `${formatBerlinTime(entry!.start)}–${formatBerlinTime(entry!.end)}`;
        const entryName = `${entry!.resource.name}: ${timeRange} · Booked by ${entry!.bookedBy.name} for ${entry!.bookedFor.name}.`;
        await page.getByRole('link', { name: entryName, exact: true }).click();

        await expect(page).toHaveURL(`/bookings/${booking.id}`);

        await page.getByRole('button', { name: 'Cancel booking' }).click();
        await expect(page.getByRole('dialog')).toBeVisible();

        const [cancelResponse] = await Promise.all([
          page.waitForResponse(
            (res) =>
              res.url().endsWith(`/api/bookings/${booking.id}`) && res.request().method() === 'DELETE',
          ),
          page.getByRole('button', { name: 'Yes, cancel it' }).click(),
        ]);
        expect([200, 204, 404]).toContain(cancelResponse.status());

        await expect(page.getByRole('status')).toHaveText('This booking has been cancelled.');

        // Return to the resource's schedule the same way a real user
        // would, entirely via the app's own persistent SPA navigation
        // (never `page.reload()`/`page.goto()`): the main nav's
        // "Resources" link, then that resource's own link (which lands
        // on today's schedule by default, matching `resource-list.spec.ts`'s
        // documented behaviour) — never a hard navigation back to the
        // schedule URL, so this genuinely exercises the mutation's
        // `invalidateQueries` seam rather than a fresh app boot's normal
        // fetch-on-mount.
        const scheduleRefetch = page.waitForResponse(
          (res) =>
            res.url().includes(`/api/resources/${PROJECTOR_CART_A_ID}/schedule`) &&
            res.request().method() === 'GET',
        );
        await page.getByRole('link', { name: 'Resources' }).click();
        await expect(page).toHaveURL('/resources');
        await page.getByRole('link', { name: 'Projector Cart A' }).click();

        const refetchResponse = await scheduleRefetch;
        expect(refetchResponse.status()).toBe(200);
        const refetchedBody = (await refetchResponse.json()) as { segments: LiveScheduleSegment[] };

        await expect(page).toHaveURL(`/resources/${PROJECTOR_CART_A_ID}/schedule/${today}`);

        // The cancelled booking's own time range must now render as free
        // — matching the server's OWN freshly recomputed segments, not a
        // client-side patch.
        expect(refetchedBody.segments.every((segment) => segment.type === 'free')).toBe(true);
        await expect(page.getByText('This resource is free all day.')).toBeVisible();
        await expect(page.getByText(entryName, { exact: false })).toHaveCount(0);

        const results = await new AxeBuilder({ page }).include('section').analyze();
        expect(results.violations).toEqual([]);
      } finally {
        await deleteLiveBooking(request, booking.id);
      }
    });
  });
});

/** Converts an ISO instant to the bare Europe/Berlin local `YYYY-MM-
 * DDTHH:mm` string a native `datetime-local` input's `.value` holds —
 * independently re-implemented (never imported) from
 * `frontend/src/lib/dates.ts#toBerlinDateTimeLocalInputValue`, mirroring
 * this whole suite's convention of never trusting the app's own module
 * to validate itself. */
function berlinInstantToLocalInputValue(isoInstant: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Berlin',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(new Date(isoInstant))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function bookedForButton(page: Page) {
  return page.getByRole('button', { name: /Booked for$/ });
}

function purposeButton(page: Page) {
  return page.getByRole('button', { name: /Purpose$/ });
}

/** Opens a `FormSelectField` via keyboard (`Enter`) and chooses
 * `optionName` from its listbox via keyboard typeahead — mirrors
 * `booking-form.spec.ts`'s own helper of the same name, duplicated here
 * (a local support module for both files would be a larger refactor than
 * this ticket's own scope) rather than driving the select with a mouse
 * click. */
async function chooseByKeyboard(page: Page, trigger: ReturnType<typeof bookedForButton>, optionName: string) {
  await trigger.focus();
  await page.keyboard.press('Enter');
  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();
  const option = listbox.getByRole('option', { name: optionName, exact: true });
  await expect(option).toBeVisible();
  await page.keyboard.type(optionName.slice(0, 3), { delay: 20 });
  await expect(option).toHaveAttribute('data-focused', 'true');
  await page.keyboard.press('Enter');
  await expect(listbox).toHaveCount(0);
  await expect(trigger).toContainText(optionName);
}
