import { test, expect } from './support/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Issue #41 (Task 3.3, Phase 3 — UI, FS-02 §6.3/FR-3/AC-11) ACs covered
 * by this file, against the two seeded "Nebel" bookings in
 * `backend/migrations/0003_seed_data.sql` (never mutated by these
 * tests — every request is a read, `page.route` interception, or a
 * placeholder-only click that does not fire `DELETE`):
 *
 *  - "All five booking attributes are displayed."
 *  - "The cancel action appears for the creator and is absent for
 *    anyone else."
 *  - "Cancel permission comes from the server response, not a
 *    client-side comparison."
 *  - "Choosing cancel opens the confirmation rather than cancelling
 *    immediately."
 *  - "Times are shown in local time with no time-zone choice."
 *
 * `booking-wiring.spec.ts` (issue #39) already covers this route's
 * loading/not-found/error-retry wiring — this file only covers issue
 * #41's own success-rendering/cancel-seam ACs, against real seeded
 * data rather than a freshly created booking, since the seed rows are
 * exactly the "creator" vs "not the creator" pair the ACs need.
 */

const API_BASE_URL = 'http://localhost:3001';

/** Booking created by Alex Nguyen (the default `CURRENT_PERSON_ID`) for
 * Brigitte Kaya — the server reports `canCancel: true` for this one. */
const CREATOR_BOOKING_ID = 'a2c9f7d1-24bb-4d5e-802e-24e8fa6ff288';

/** Booking created by Brigitte Kaya (not the current person) — the
 * server reports `canCancel: false` for this one. */
const OTHER_PERSON_BOOKING_ID = '72534d6a-6c0a-4527-9ee7-13e4bbaafab1';

/** Booking created by Chidi Okafor *for* the current person, Alex
 * Nguyen — `bookedFor` matches the current person while `bookedBy`
 * does not. A client-side comparison that (incorrectly) keyed off
 * `bookedFor` instead of `bookedBy` would show the button here; the
 * server correctly reports `canCancel: false`. */
const BOOKED_FOR_CURRENT_PERSON_BOOKING_ID = '66c758b4-d200-455c-baaf-30d6c4ad4c73';

test.describe('booking detail view (/bookings/:id) — issue #41', () => {
  test('AC: all five booking attributes are displayed, in order, as a definition list', async ({
    page,
  }) => {
    await page.goto(`/bookings/${CREATOR_BOOKING_ID}`);

    await expect(page.getByRole('heading', { level: 1, name: 'Booking detail' })).toBeVisible();

    // The whole definition list in one assertion proves both presence
    // AND order of all five field pairs — not just that each fact
    // appears somewhere on the page.
    await expect(page.getByRole('region', { name: 'Booking detail' })).toMatchAriaSnapshot(`
      - heading "Booking detail" [level=1]
      - term: Resource
      - definition: Nebel
      - term: Date and time
      - definition: 1 Sept 2026, 09:00 – 1 Sept 2026, 10:00
      - term: Booked by
      - definition: Alex Nguyen
      - term: Booked for
      - definition: Brigitte Kaya
      - term: Purpose
      - definition: Meeting
      - button "Cancel booking"
    `);
  });

  test('AC: times are shown in Berlin local time with no time-zone abbreviation, offset, or choice offered', async ({
    page,
  }) => {
    await page.goto(`/bookings/${CREATOR_BOOKING_ID}`);

    const dateTimeValue = page
      .getByRole('definition')
      .filter({ hasText: '1 Sept 2026, 09:00' });
    await expect(dateTimeValue).toContainText('1 Sept 2026, 10:00');

    // The 07:00Z/08:00Z instants must render as Berlin's 09:00/10:00
    // (UTC+2 in September) — not as the raw UTC instant.
    await expect(page.getByText('07:00', { exact: false })).toHaveCount(0);
    await expect(page.getByText('08:00', { exact: false })).toHaveCount(0);

    // No timezone abbreviation/offset anywhere on the page, and no
    // control that would let the user pick a different zone.
    const bodyText = await page.locator('body').innerText();
    for (const marker of ['UTC', 'GMT', 'CEST', 'CET', '+02:00', '+00:00', 'Z ']) {
      expect(bodyText).not.toContain(marker);
    }
    await expect(page.getByRole('combobox', { name: /time.?zone/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /time.?zone/i })).toHaveCount(0);
  });

  test('AC: the cancel action is present for the booking\'s creator', async ({ page }) => {
    await page.goto(`/bookings/${CREATOR_BOOKING_ID}`);

    await expect(page.getByRole('definition').filter({ hasText: 'Alex Nguyen' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel booking' })).toBeVisible();
  });

  test('AC: the cancel action is completely absent (not disabled) for a booking created by someone else', async ({
    page,
  }) => {
    await page.goto(`/bookings/${OTHER_PERSON_BOOKING_ID}`);

    await expect(page.getByRole('definition').filter({ hasText: 'Brigitte Kaya' }).first()).toBeVisible();
    // Absent from the DOM entirely — not rendered-and-disabled.
    await expect(page.getByRole('button', { name: 'Cancel booking' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cancel booking', disabled: true })).toHaveCount(0);
  });

  test('AC: the cancel action is absent even when the current person is the "booked for" person but not the creator', async ({
    page,
  }) => {
    // Guards against a client-side comparison that (wrongly) checks
    // `bookedFor` instead of `bookedBy` against the current person.
    await page.goto(`/bookings/${BOOKED_FOR_CURRENT_PERSON_BOOKING_ID}`);

    await expect(page.getByRole('definition').filter({ hasText: 'Chidi Okafor' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel booking' })).toHaveCount(0);
  });

  test('AC: cancel permission is taken verbatim from the server\'s canCancel flag, not re-derived from bookedBy/bookedFor client-side', async ({
    page,
    request,
  }) => {
    const me = await (await request.get(`${API_BASE_URL}/api/me`)).json();

    // Case 1: server says the current person IS the creator (bookedBy
    // === current person id) but explicitly reports canCancel: false.
    // If the UI derived permission itself, the button would wrongly
    // appear here.
    await page.route(`**/api/bookings/${CREATOR_BOOKING_ID}`, async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          booking: {
            id: CREATOR_BOOKING_ID,
            resource: { id: '11111111-1111-1111-1111-111111111111', name: 'Nebel', type: 'room' },
            bookedBy: { id: me.id, name: me.name },
            bookedFor: { id: '22222222-2222-2222-2222-222222222222', name: 'Brigitte Kaya' },
            purpose: { id: 'Meeting', label: 'Meeting' },
            start: '2026-09-01T07:00:00.000Z',
            end: '2026-09-01T08:00:00.000Z',
          },
          canCancel: false,
        }),
      });
    });

    await page.goto(`/bookings/${CREATOR_BOOKING_ID}`);
    await expect(page.getByRole('definition').filter({ hasText: me.name }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel booking' })).toHaveCount(0);
    await page.unroute(`**/api/bookings/${CREATOR_BOOKING_ID}`);

    // Case 2: server says the current person is NOT the creator
    // (bookedBy is someone else) but explicitly reports canCancel:
    // true. If the UI derived permission itself, the button would
    // wrongly be hidden here.
    await page.route(`**/api/bookings/${OTHER_PERSON_BOOKING_ID}`, async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          booking: {
            id: OTHER_PERSON_BOOKING_ID,
            resource: { id: '11111111-1111-1111-1111-111111111111', name: 'Nebel', type: 'room' },
            bookedBy: { id: '22222222-2222-2222-2222-222222222222', name: 'Brigitte Kaya' },
            bookedFor: { id: '22222222-2222-2222-2222-222222222222', name: 'Brigitte Kaya' },
            purpose: { id: 'Focus work', label: 'Focus work' },
            start: '2026-09-01T08:00:00.000Z',
            end: '2026-09-01T09:00:00.000Z',
          },
          canCancel: true,
        }),
      });
    });

    await page.goto(`/bookings/${OTHER_PERSON_BOOKING_ID}`);
    await expect(page.getByRole('definition').filter({ hasText: 'Brigitte Kaya' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel booking' })).toBeVisible();
    await page.unroute(`**/api/bookings/${OTHER_PERSON_BOOKING_ID}`);
  });

  test('AC: choosing "Cancel booking" opens a confirmation dialog instead of cancelling immediately, and never fires DELETE', async ({
    page,
  }) => {
    const deleteRequests: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'DELETE' && req.url().includes('/api/bookings/')) {
        deleteRequests.push(req.url());
      }
    });

    await page.goto(`/bookings/${CREATOR_BOOKING_ID}`);

    const cancelButton = page.getByRole('button', { name: 'Cancel booking' });
    await expect(cancelButton).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await cancelButton.click();

    // Issue #43 replaced this route's placeholder confirmation seam with
    // the real modal dialog — full coverage of the dialog itself
    // (naming the booking, focus trapping/restoration, Escape/underlay
    // dismissal, the success/failure/race outcomes) lives in
    // `cancel-booking-dialog.spec.ts`; this file only re-asserts that
    // choosing "Cancel booking" opens *some* confirmation rather than
    // cancelling immediately, and that backing out never fires DELETE.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const backOutButton = dialog.getByRole('button', { name: 'No, keep it' });
    await expect(backOutButton).toBeVisible();

    // No DELETE was fired merely by opening the confirmation dialog.
    expect(deleteRequests).toEqual([]);

    // Backing out closes the dialog again, leaving the booking
    // untouched, and still without ever calling DELETE.
    await backOutButton.click();
    await expect(dialog).toHaveCount(0);
    await expect(cancelButton).toBeVisible();
    expect(deleteRequests).toEqual([]);

    // The booking is untouched: a reload still shows it (proves no
    // DELETE landed server-side either, not just that none was seen
    // client-side).
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Booking detail' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(cancelButton).toBeVisible();
  });

  test('AC: the cancel confirmation is reachable and operable by keyboard alone', async ({ page }) => {
    const deleteRequests: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'DELETE' && req.url().includes('/api/bookings/')) {
        deleteRequests.push(req.url());
      }
    });

    await page.goto(`/bookings/${CREATOR_BOOKING_ID}`);

    const cancelButton = page.getByRole('button', { name: 'Cancel booking' });
    await expect(cancelButton).toBeVisible();

    let guard = 0;
    while (!(await cancelButton.evaluate((el) => el === document.activeElement)) && guard < 25) {
      await page.keyboard.press('Tab');
      guard += 1;
    }
    await expect(cancelButton).toBeFocused();
    await page.keyboard.press('Enter');

    const backOutButton = page.getByRole('button', { name: 'No, keep it' });
    await expect(backOutButton).toBeVisible();
    expect(deleteRequests).toEqual([]);

    await backOutButton.focus();
    await expect(backOutButton).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(backOutButton).toHaveCount(0);
    expect(deleteRequests).toEqual([]);
  });

  test('AC: the booking detail view (with cancel affordance shown) has no automatically detectable accessibility violations', async ({
    page,
  }) => {
    await page.goto(`/bookings/${CREATOR_BOOKING_ID}`);
    await expect(page.getByRole('button', { name: 'Cancel booking' })).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('AC: the booking detail view (with cancel affordance absent) has no automatically detectable accessibility violations', async ({
    page,
  }) => {
    await page.goto(`/bookings/${OTHER_PERSON_BOOKING_ID}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Booking detail' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel booking' })).toHaveCount(0);

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
