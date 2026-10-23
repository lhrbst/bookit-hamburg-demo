import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  fetchLiveFilteredSchedule,
  type LiveScheduleSegment,
} from './support/api';
import { formatBerlinTime } from './support/dates';

/**
 * Issue #27 (Task 3.3, Phase 3 — UI views, FS-01 FR-3/§6.4) ACs covered by
 * this file:
 *
 *  - AC-6: filtering by booker leaves only that person's bookings.
 *  - AC-6a: filtering by booked-for person leaves only bookings for that
 *    person.
 *  - AC-7: multiple active filters apply together (additively).
 *  - AC-8: clearing filters restores the unfiltered schedule.
 *  - Currently active filters are visibly summarised.
 *  - No control in this view offers changing the resource itself (FR-3).
 *
 * Day navigation (issue #24) is deliberately NOT retested here.
 *
 * All scenarios run against the real, seeded "Nebel" room on 2026-09-01,
 * which has a genuine back-to-back pair of bookings (FS-03 §10 fixture):
 *   09:00–10:00 booked by Alex Nguyen, booked for Brigitte Kaya
 *   10:00–11:00 booked by Brigitte Kaya, booked for Brigitte Kaya
 *
 * Expected segment TEXT for each filtered scenario is derived from the
 * live, filtered `GET /api/resources/:id/schedule` response itself
 * (`fetchLiveFilteredSchedule`), rather than hardcoded/assumed — this
 * shared dev database has been observed to carry additional bookings for
 * Nebel/2026-09-01 beyond the two the migration seeds (e.g. left behind by
 * earlier ad hoc manual/API testing sessions), so asserting a fixed
 * "free all day" shape would be wrong. Deriving expectations from the
 * live backend keeps this spec correct regardless of exactly what else is
 * in the database, while still proving each filter narrows the UI exactly
 * as the backend says it should — this file's own responsibility, not the
 * backend's segment-partition logic (already covered by
 * `resource-schedule-segments.spec.ts`, issue #26).
 *
 * The seed id for "Nebel" (`backend/migrations/0003_seed_data.sql`) is a
 * fixed migration constant, not app-generated, so it is used directly
 * rather than discovered through an extra round trip — same convention
 * `resource-schedule-segments.spec.ts` already established for this exact
 * fixture.
 *
 * NOTE on locators: `PersonFilterSelect`'s React Aria `Select` button
 * carries BOTH an explicit `aria-label={label}` AND an associated
 * `<Label>{label}</Label>`, so its accessible name doubles up the label
 * text (observed live: "Anyone Booked by Booked by", "Alex Nguyen Booked
 * by Booked by", etc. — reported as a defect, see the final report).
 * Locators below match the stable substring ("Booked by"/"Booked for")
 * via regex rather than the exact (duplicated, and therefore fragile)
 * full string.
 */
const NEBEL_ID = '11111111-1111-1111-1111-111111111111';
const DATE = '2026-09-01';
const ALEX_ID = '22222222-2222-2222-2222-222222222221';
const BRIGITTE_ID = '22222222-2222-2222-2222-222222222222';

/** Renders a segment's expected accessible text, matching
 * `ResourceScheduleRoute`'s own list-item copy exactly — same technique
 * (and same reason: never trust the app to agree with itself) as
 * `resource-schedule-segments.spec.ts#expectedSegmentText`. */
function expectedSegmentText(segment: LiveScheduleSegment): string {
  const timeRange = `${formatBerlinTime(segment.start)}–${formatBerlinTime(segment.end)}`;
  if (segment.type === 'free') {
    // Issue #44: every free segment also carries a "Book this free
    // slot, HH:mm–HH:mm" link, part of the same `<li>`'s text content.
    return `Free ${timeRange}. Book this free slot, ${timeRange}`;
  }
  return `Booked ${timeRange} · Booked by ${segment.bookedBy?.name} for ${segment.bookedFor?.name}.`;
}

function scheduleList(page: Page) {
  return page.getByRole('list', { name: `Schedule for Nebel on ${DATE}` });
}

/** The "Booked by" filter's trigger button — see the locator note above. */
function bookedBySelect(page: Page) {
  return page.getByRole('button', { name: /Booked by/ });
}

/** The "Booked for" filter's trigger button — see the locator note above. */
function bookedForSelect(page: Page) {
  return page.getByRole('button', { name: /Booked for/ });
}

async function choosePerson(select: ReturnType<typeof bookedBySelect>, page: Page, personName: string) {
  await select.click();
  await page.getByRole('option', { name: personName, exact: true }).click();
}

/** Asserts the rendered list matches the live backend's segments for this
 * exact filter combination, in order — the same "trust the API, not an
 * assumption" technique `resource-schedule-segments.spec.ts` uses. */
async function expectListMatchesLiveFilteredSchedule(
  page: Page,
  request: Parameters<typeof fetchLiveFilteredSchedule>[0],
  filters: { bookedById?: string; bookedForId?: string },
) {
  const liveSchedule = await fetchLiveFilteredSchedule(request, NEBEL_ID, DATE, filters);
  const list = scheduleList(page);
  const items = list.getByRole('listitem');
  await expect(items).toHaveCount(liveSchedule.segments.length);
  for (const [index, segment] of liveSchedule.segments.entries()) {
    await expect(items.nth(index)).toHaveText(expectedSegmentText(segment));
  }
  return liveSchedule.segments;
}

test.describe('resource schedule person filters (issue #27)', () => {
  test('unfiltered baseline: both seeded bookings are shown and the summary states no filters are applied', async ({
    page,
    request,
  }) => {
    await page.goto(`/resources/${NEBEL_ID}/schedule/${DATE}`);

    const segments = await expectListMatchesLiveFilteredSchedule(page, request, {});
    const bookedSegments = segments.filter((s) => s.type === 'booked');
    expect(bookedSegments.some((s) => s.bookedBy?.name === 'Alex Nguyen')).toBe(true);
    expect(bookedSegments.some((s) => s.bookedBy?.name === 'Brigitte Kaya')).toBe(true);

    await expect(page.getByText('Showing all bookings (no filters applied).')).toBeVisible();

    const clearButton = page.getByRole('button', { name: 'Clear filters' });
    await expect(clearButton).toBeVisible();
    await expect(clearButton).toBeDisabled();

    // Both selects start on the unset "Anyone" option.
    await expect(bookedBySelect(page)).toContainText('Anyone');
    await expect(bookedForSelect(page)).toContainText('Anyone');
  });

  test('AC-6: filtering by "Booked by" = Alex Nguyen narrows the list to exactly the bookings the live API returns for that filter', async ({
    page,
    request,
  }) => {
    await page.goto(`/resources/${NEBEL_ID}/schedule/${DATE}`);
    await expect(scheduleList(page).getByRole('listitem').first()).toBeVisible();

    // Ground truth first: the unfiltered view must contain a Brigitte
    // Kaya booking that will be released by this filter, or the test
    // proves nothing.
    const unfiltered = await fetchLiveFilteredSchedule(request, NEBEL_ID, DATE, {});
    expect(unfiltered.segments.some((s) => s.type === 'booked' && s.bookedBy?.name === 'Brigitte Kaya')).toBe(
      true,
    );

    await choosePerson(bookedBySelect(page), page, 'Alex Nguyen');

    const filtered = await expectListMatchesLiveFilteredSchedule(page, request, { bookedById: ALEX_ID });
    expect(filtered.every((s) => s.type === 'free' || s.bookedBy?.name === 'Alex Nguyen')).toBe(true);
    expect(filtered.some((s) => s.type === 'free')).toBe(true);
    expect(filtered.some((s) => s.type === 'booked' && s.bookedBy?.name === 'Brigitte Kaya')).toBe(false);

    await expect(page.getByText(/booked by Alex Nguyen/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear filters' })).toBeEnabled();
  });

  test('AC-6a: filtering by "Booked for" narrows correctly — a person nobody booked the 09:00–11:00 pair for excludes both, "Brigitte Kaya" keeps both', async ({
    page,
    request,
  }) => {
    await page.goto(`/resources/${NEBEL_ID}/schedule/${DATE}`);
    await expect(scheduleList(page).getByRole('listitem').first()).toBeVisible();

    // Neither seeded booking in the 09:00–11:00 pair is *for* Chidi Okafor
    // — a person guaranteed not to be the booked-for party of any Nebel
    // fixture booking on this day, so this assertion holds regardless of
    // whatever else the shared dev database carries.
    const CHIDI_ID = '22222222-2222-2222-2222-222222222223';
    await choosePerson(bookedForSelect(page), page, 'Chidi Okafor');

    const filteredForChidi = await expectListMatchesLiveFilteredSchedule(page, request, {
      bookedForId: CHIDI_ID,
    });
    expect(
      filteredForChidi.some(
        (s) =>
          s.type === 'booked' &&
          (formatBerlinTime(s.start) === '09:00' || formatBerlinTime(s.start) === '10:00'),
      ),
    ).toBe(false);
    await expect(page.getByText(/booked for Chidi Okafor/)).toBeVisible();

    // Switching to "Brigitte Kaya" (booked-for on BOTH seeded bookings)
    // must keep both — a positive, correctly-narrowing check.
    await choosePerson(bookedForSelect(page), page, 'Brigitte Kaya');

    const filteredForBrigitte = await expectListMatchesLiveFilteredSchedule(page, request, {
      bookedForId: BRIGITTE_ID,
    });
    const bookedTimes = filteredForBrigitte
      .filter((s) => s.type === 'booked')
      .map((s) => `${formatBerlinTime(s.start)}-${formatBerlinTime(s.end)}`);
    expect(bookedTimes).toContain('09:00-10:00');
    expect(bookedTimes).toContain('10:00-11:00');
    await expect(page.getByText(/booked for Brigitte Kaya/)).toBeVisible();
  });

  test('AC-7: "Booked by" and "Booked for" filters apply additively', async ({ page, request }) => {
    await page.goto(`/resources/${NEBEL_ID}/schedule/${DATE}`);
    await expect(scheduleList(page).getByRole('listitem').first()).toBeVisible();

    await choosePerson(bookedBySelect(page), page, 'Brigitte Kaya');
    await choosePerson(bookedForSelect(page), page, 'Brigitte Kaya');

    // Only the 10:00–11:00 booking matches BOTH filters (booked by AND
    // for Brigitte Kaya). The 09:00–10:00 booking is booked for Brigitte
    // Kaya too, but booked BY Alex Nguyen — must be excluded, releasing
    // its hour as free.
    const filtered = await expectListMatchesLiveFilteredSchedule(page, request, {
      bookedById: BRIGITTE_ID,
      bookedForId: BRIGITTE_ID,
    });
    const booked = filtered.filter((s) => s.type === 'booked');
    expect(booked).toHaveLength(1);
    expect(formatBerlinTime(booked[0].start)).toBe('10:00');
    expect(formatBerlinTime(booked[0].end)).toBe('11:00');
    // The 09:00–10:00 booking's hour is released as free — proven above by
    // `expectListMatchesLiveFilteredSchedule` (which asserts the list's
    // exact text/order against the live filtered response, including
    // whatever free segment replaces the excluded booking).

    const summary = page.getByText(/Showing bookings/);
    await expect(summary).toContainText(/booked by Brigitte Kaya/);
    await expect(summary).toContainText(/booked for Brigitte Kaya/);
  });

  test('AC-8: clearing filters restores the unfiltered schedule and resets both selects to "Anyone"', async ({
    page,
    request,
  }) => {
    await page.goto(`/resources/${NEBEL_ID}/schedule/${DATE}`);
    await expect(scheduleList(page).getByRole('listitem').first()).toBeVisible();

    await choosePerson(bookedBySelect(page), page, 'Brigitte Kaya');
    await choosePerson(bookedForSelect(page), page, 'Brigitte Kaya');
    await expectListMatchesLiveFilteredSchedule(page, request, {
      bookedById: BRIGITTE_ID,
      bookedForId: BRIGITTE_ID,
    });

    const clearButton = page.getByRole('button', { name: 'Clear filters' });
    await expect(clearButton).toBeEnabled();
    await clearButton.click();

    await expectListMatchesLiveFilteredSchedule(page, request, {});
    await expect(page.getByText('Showing all bookings (no filters applied).')).toBeVisible();
    await expect(bookedBySelect(page)).toContainText('Anyone');
    await expect(bookedForSelect(page)).toContainText('Anyone');
    await expect(clearButton).toBeDisabled();
  });

  test('keyboard operability: the "Booked by" filter can be selected using only the keyboard', async ({
    page,
    request,
  }) => {
    await page.goto(`/resources/${NEBEL_ID}/schedule/${DATE}`);
    await expect(scheduleList(page).getByRole('listitem').first()).toBeVisible();

    const select = bookedBySelect(page);
    await select.focus();
    await expect(select).toBeFocused();

    // Open with Enter, move past "Anyone" (the first, already-selected
    // option) to "Alex Nguyen" with ArrowDown, and confirm with Enter —
    // no mouse interaction anywhere in this test.
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    const filtered = await expectListMatchesLiveFilteredSchedule(page, request, { bookedById: ALEX_ID });
    expect(filtered.some((s) => s.type === 'booked' && s.bookedBy?.name === 'Brigitte Kaya')).toBe(false);
    await expect(page.getByText(/booked by Alex Nguyen/)).toBeVisible();
    await expect(select).toBeFocused();

    // Escape closes the popover WITHOUT changing the selection — confirm
    // that path too, on the second select.
    const otherSelect = bookedForSelect(page);
    await otherSelect.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(otherSelect).toContainText('Anyone');
    await expect(page.getByText(/booked for/)).toHaveCount(0);
  });

  test('no control in this view lets the user change the resource being shown', async ({ page }) => {
    await page.goto(`/resources/${NEBEL_ID}/schedule/${DATE}`);
    await expect(scheduleList(page).getByRole('listitem').first()).toBeVisible();

    // Exactly the two person filters exist as select-pattern controls on
    // this page — nothing offers changing the resource itself (FR-3).
    await expect(bookedBySelect(page)).toBeVisible();
    await expect(bookedForSelect(page)).toBeVisible();
    await expect(page.getByRole('combobox')).toHaveCount(0);
    await expect(page.getByRole('listbox')).toHaveCount(0);
    // (`getByLabel(/resource/i)` is not used here: the view's own <h1>
    // legitimately contains the word "resource" and would false-positive
    // via `aria-labelledby` — a button/select accessible name check is the
    // meaningful assertion for "no resource-selection control exists".)
    await expect(page.getByRole('button', { name: /resource/i })).toHaveCount(0);

    const group = page.getByRole('group', { name: 'Filter this schedule' });
    await expect(group).toBeVisible();
    await expect(group.getByText('Filters', { exact: true })).toBeVisible();
  });

  test('the filtered resource schedule view has no automatically detectable accessibility violations', async ({
    page,
    request,
  }) => {
    await page.goto(`/resources/${NEBEL_ID}/schedule/${DATE}`);
    await expect(scheduleList(page).getByRole('listitem').first()).toBeVisible();

    await choosePerson(bookedBySelect(page), page, 'Brigitte Kaya');
    await expectListMatchesLiveFilteredSchedule(page, request, { bookedById: BRIGITTE_ID });

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
