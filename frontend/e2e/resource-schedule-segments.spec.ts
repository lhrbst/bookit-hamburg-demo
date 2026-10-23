import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  fetchLiveScheduleForDate,
  createLiveBooking,
  deleteLiveBooking,
  type LiveScheduleSegment,
} from './support/api';
import { formatBerlinTime } from './support/dates';

/**
 * Issue #26 ACs covered by this file (real chronological segment
 * rendering, replacing the placeholder text `resource-schedule.spec.ts`
 * used to assert on):
 *
 *  - AC-2/AC-12: every segment the backend returns for a resource/day is
 *    rendered, in the order the backend returned it, with no
 *    merging/filtering, each explicitly labelled "Booked"/"Free" with the
 *    booking's creator/subject when booked.
 *  - AC-3: day navigation ("Next day") re-renders the list for the new
 *    day.
 *  - AC-4: a day with no booked segments at all renders an extra "This
 *    resource is free all day." statement above the list.
 *  - AC-13: a booking crossing a Europe/Berlin calendar-midnight is
 *    rendered as two segments (one per day it touches), each carrying the
 *    correct "continues from/into" wording.
 *  - Back-to-back bookings (FS-03 §10) are never merged into one entry
 *    and never flagged as a clash/conflict.
 *  - Automated accessibility scan of a real, non-empty schedule list.
 *
 * These tests always confirm expected times/order against the *live*
 * backend response first (never a hardcoded guess), per this ticket's own
 * instruction, since seed data shifts over time.
 */

const NEBEL_ID = '11111111-1111-1111-1111-111111111111';
const ELBE_ID = '11111111-1111-1111-1111-111111111112';
const PROJECTOR_CART_A_ID = '11111111-1111-1111-1111-111111111113';

/** Renders a single segment's expected accessible text, matching
 * `ResourceScheduleRoute`'s own list-item copy exactly, computed
 * independently from the live segment data (never hardcoded). */
function expectedSegmentText(segment: LiveScheduleSegment): string {
  const timeRange = `${formatBerlinTime(segment.start)}–${formatBerlinTime(segment.end)}`;

  if (segment.type === 'free') {
    // Issue #44: every free segment also carries a "Book this free
    // slot, HH:mm–HH:mm" link (the Flow A entry point into the booking
    // form) rendered as part of the same `<li>`'s text content.
    return `Free ${timeRange}. Book this free slot, ${timeRange}`;
  }

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

/** Adds `delta` calendar days to a `YYYY-MM-DD` key, using an inert UTC
 * calendar (never the browser's local time zone) — same technique as
 * `frontend/src/lib/dates.ts#addDays`, reimplemented here so a bug there
 * cannot silently make this test agree with the app under test. */
function addCalendarDays(dayKey: string, delta: number): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  const moved = new Date(Date.UTC(year, month - 1, day) + delta * 86_400_000);
  const y = String(moved.getUTCFullYear()).padStart(4, '0');
  const m = String(moved.getUTCMonth() + 1).padStart(2, '0');
  const d = String(moved.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

test.describe('resource schedule segment rendering (issue #26)', () => {
  test('AC-2/AC-12: renders every segment in chronological order with free segments surrounding a booking, and the booking shows both creator and subject', async ({
    page,
    request,
  }) => {
    const liveSchedule = await fetchLiveScheduleForDate(request, ELBE_ID, '2026-09-01');
    // Ground truth from the live backend — not assumed.
    expect(liveSchedule.segments.length).toBeGreaterThan(0);

    await page.goto(`/resources/${ELBE_ID}/schedule/2026-09-01`);

    const list = page.getByRole('list', {
      name: `Schedule for ${liveSchedule.resource.name} on 2026-09-01`,
    });
    await expect(list).toBeVisible();

    const items = list.getByRole('listitem');
    await expect(items).toHaveCount(liveSchedule.segments.length);

    for (const [index, segment] of liveSchedule.segments.entries()) {
      await expect(items.nth(index)).toHaveText(expectedSegmentText(segment));
    }

    // At least one segment must be a real booking with distinct
    // creator/subject, for this to be a meaningful AC-12 check.
    const bookedSegments = liveSchedule.segments.filter(
      (segment): segment is LiveScheduleSegment & { type: 'booked' } => segment.type === 'booked',
    );
    expect(bookedSegments.length).toBeGreaterThan(0);

    // Since the seeded booking data may change over time, only assert
    // that no "free all day" message is shown (there IS a booking).
    await expect(page.getByText('This resource is free all day.')).toHaveCount(0);
  });

  test('AC-4: a day with no bookings at all shows the "free all day" statement, and the list still contains a single all-day free entry', async ({
    page,
    request,
  }) => {
    const liveSchedule = await fetchLiveScheduleForDate(request, PROJECTOR_CART_A_ID, '2026-09-01');
    expect(liveSchedule.segments.every((segment) => segment.type === 'free')).toBe(true);

    await page.goto(`/resources/${PROJECTOR_CART_A_ID}/schedule/2026-09-01`);

    await expect(page.getByText('This resource is free all day.')).toBeVisible();

    const list = page.getByRole('list', {
      name: `Schedule for ${liveSchedule.resource.name} on 2026-09-01`,
    });
    const items = list.getByRole('listitem');
    await expect(items).toHaveCount(liveSchedule.segments.length);
    await expect(items.first()).toHaveText(expectedSegmentText(liveSchedule.segments[0]));
  });

  test('back-to-back bookings are rendered as separate list entries with no free segment between them, and are never described as a conflict/clash', async ({
    page,
    request,
  }) => {
    const liveSchedule = await fetchLiveScheduleForDate(request, NEBEL_ID, '2026-09-01');

    await page.goto(`/resources/${NEBEL_ID}/schedule/2026-09-01`);

    const list = page.getByRole('list', {
      name: `Schedule for ${liveSchedule.resource.name} on 2026-09-01`,
    });
    const items = list.getByRole('listitem');
    await expect(items).toHaveCount(liveSchedule.segments.length);

    // Find at least one pair of back-to-back booked segments (one ends
    // exactly where the next begins) in the live data — the seeded
    // fixture for Nebel/2026-09-01 is expected to contain this, but we
    // derive the indices from the live response rather than assuming.
    let foundAdjacentPair = false;
    for (let i = 0; i < liveSchedule.segments.length - 1; i += 1) {
      const current = liveSchedule.segments[i];
      const next = liveSchedule.segments[i + 1];
      if (current.type === 'booked' && next.type === 'booked' && current.end === next.start) {
        foundAdjacentPair = true;
        await expect(items.nth(i)).toHaveText(expectedSegmentText(current));
        await expect(items.nth(i + 1)).toHaveText(expectedSegmentText(next));
      }
    }
    expect(foundAdjacentPair).toBe(true);

    await expect(page.getByText(/conflict/i)).toHaveCount(0);
    await expect(page.getByText(/clash/i)).toHaveCount(0);
  });

  test('AC-13: a booking crossing a Europe/Berlin calendar-midnight renders as two segments, each labelled with the correct continuation direction', async ({
    page,
    request,
  }) => {
    // A random day offset (far from 2026-09-01's seed data and from other
    // tests in this file) so parallel workers/repeated runs never collide
    // on the same slot and spuriously 409 each other.
    const randomDayOffset = Math.floor(Math.random() * 2000);
    const day1 = addCalendarDays('2026-09-15', randomDayOffset);
    const day2 = addCalendarDays(day1, 1);

    const booking = await createLiveBooking(request, {
      resourceId: PROJECTOR_CART_A_ID,
      bookedForId: '22222222-2222-2222-2222-222222222221',
      purposeId: 'Meeting',
      start: `${day1}T23:00`,
      end: `${day2}T01:00`,
    });

    try {
      const day1Schedule = await fetchLiveScheduleForDate(request, PROJECTOR_CART_A_ID, day1);
      const day1Booked = day1Schedule.segments.find((segment) => segment.type === 'booked');
      expect(day1Booked).toBeDefined();
      expect(day1Booked?.continuesIntoNextDay).toBe(true);
      expect(day1Booked?.continuesFromPreviousDay).toBe(false);

      await page.goto(`/resources/${PROJECTOR_CART_A_ID}/schedule/${day1}`);
      const day1List = page.getByRole('list', {
        name: `Schedule for ${day1Schedule.resource.name} on ${day1}`,
      });
      await expect(day1List.getByText(expectedSegmentText(day1Booked as LiveScheduleSegment))).toBeVisible();
      await expect(
        day1List.getByText('This booking continues into the next day.', { exact: false }),
      ).toBeVisible();

      const day2Schedule = await fetchLiveScheduleForDate(request, PROJECTOR_CART_A_ID, day2);
      const day2Booked = day2Schedule.segments.find((segment) => segment.type === 'booked');
      expect(day2Booked).toBeDefined();
      expect(day2Booked?.continuesFromPreviousDay).toBe(true);
      expect(day2Booked?.continuesIntoNextDay).toBe(false);

      await page.goto(`/resources/${PROJECTOR_CART_A_ID}/schedule/${day2}`);
      const day2List = page.getByRole('list', {
        name: `Schedule for ${day2Schedule.resource.name} on ${day2}`,
      });
      await expect(day2List.getByText(expectedSegmentText(day2Booked as LiveScheduleSegment))).toBeVisible();
      await expect(
        day2List.getByText('This booking continues from the previous day.', { exact: false }),
      ).toBeVisible();
    } finally {
      await deleteLiveBooking(request, booking.id);
    }
  });

  test('AC-3: navigating to the next day re-renders the schedule for that day, keeping the same resource', async ({
    page,
    request,
  }) => {
    const day1Schedule = await fetchLiveScheduleForDate(request, NEBEL_ID, '2026-09-01');
    const day2Schedule = await fetchLiveScheduleForDate(request, NEBEL_ID, '2026-09-02');
    // The day-2 fixture is expected to be booking-free so the "next day"
    // transition is unambiguous — verified against the live data rather
    // than assumed.
    expect(day2Schedule.segments.every((segment) => segment.type === 'free')).toBe(true);
    expect(day1Schedule.segments.some((segment) => segment.type === 'booked')).toBe(true);

    await page.goto(`/resources/${NEBEL_ID}/schedule/2026-09-01`);

    await expect(
      page.getByRole('heading', { level: 1, name: `Schedule for resource ${NEBEL_ID} on 2026-09-01` }),
    ).toBeVisible();
    await expect(page.getByText('This resource is free all day.')).toHaveCount(0);

    await page.getByRole('button', { name: 'Next day' }).click();

    await expect(
      page.getByRole('heading', { level: 1, name: `Schedule for resource ${NEBEL_ID} on 2026-09-02` }),
    ).toBeVisible();
    await expect(page).toHaveURL(`/resources/${NEBEL_ID}/schedule/2026-09-02`);
    await expect(page.getByText('This resource is free all day.')).toBeVisible();

    const list = page.getByRole('list', {
      name: `Schedule for ${day2Schedule.resource.name} on 2026-09-02`,
    });
    await expect(list.getByRole('listitem')).toHaveCount(day2Schedule.segments.length);
  });

  test('the resource schedule view with real booked and free segments has no automatically detectable accessibility violations', async ({
    page,
    request,
  }) => {
    const liveSchedule = await fetchLiveScheduleForDate(request, NEBEL_ID, '2026-09-01');
    expect(liveSchedule.segments.some((segment) => segment.type === 'booked')).toBe(true);

    await page.goto(`/resources/${NEBEL_ID}/schedule/2026-09-01`);
    const list = page.getByRole('list', {
      name: `Schedule for ${liveSchedule.resource.name} on 2026-09-01`,
    });
    await expect(list).toBeVisible();
    await expect(list.getByRole('listitem')).toHaveCount(liveSchedule.segments.length);

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
