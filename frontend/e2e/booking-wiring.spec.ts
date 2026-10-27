import { test, expect } from './support/test';
import AxeBuilder from '@axe-core/playwright';
import { fetchLiveResources, deleteLiveBooking } from './support/api';

/**
 * Issue #39 (Task 2.1, Phase 2 — frontend foundation, FS-02 §6/§8) ACs
 * covered by this file:
 *
 *  - "Current person and purposes are loaded through a shared path" —
 *    exercised indirectly: `BookingFormRoute` renders both once the
 *    shared hooks resolve.
 *  - "Booking form, confirmation and detail routes resolve and carry the
 *    selected resource[/booking]."
 *  - "Backend field errors are exposed as a field-keyed structure plus an
 *    outcome class" — exercised indirectly via the not-found outcome
 *    rendering distinct, non-retryable copy (the same `ApiError.isNotFound`
 *    seam already proven in `resource-schedule.spec.ts`).
 *
 * This ticket is wiring-only: no real form/confirmation/detail UI exists
 * yet (issues #40/#41/#42/#43/#44). Only placeholder headings/paragraphs
 * and the new "Book this resource" link are asserted here.
 */

const API_BASE_URL = 'http://localhost:3001';

/**
 * Bookings created by {@link createLiveBooking} within the *current test*,
 * so `afterEach` below can delete each one via the real `DELETE
 * /api/bookings/:id` endpoint and return the shared Postgres database to
 * its known seed state — `createLiveBooking` used to leak a booking a
 * year in the future on every call, with nothing ever cleaning it up.
 */
let bookingIdsToCleanUp: string[] = [];

test.afterEach(async ({ request }) => {
  for (const id of bookingIdsToCleanUp) {
    await deleteLiveBooking(request, id);
  }
  bookingIdsToCleanUp = [];
});

async function createLiveBooking(request: import('@playwright/test').APIRequestContext) {
  const people = await (await request.get(`${API_BASE_URL}/api/people`)).json();
  const resources = await fetchLiveResources(request);
  const purposesResponse = await (await request.get(`${API_BASE_URL}/api/purposes`)).json();
  test.skip(
    people.length === 0 || resources.length === 0 || purposesResponse.purposes.length === 0,
    'requires seeded people, resources and purposes',
  );

  // ~a year out (avoids "start in the past"), offset by a random number of
  // hours so parallel test workers seeding against the same resource never
  // land on the same/overlapping slot and spuriously clash with each other.
  const randomHourOffset = Math.floor(Math.random() * 24 * 300);
  const start = new Date(Date.now() + 1000 * 60 * 60 * (24 * 365 + randomHourOffset));
  start.setUTCMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  // The backend's datetime validation rejects the `Z` UTC suffix that
  // `Date#toISOString()` produces — it wants an explicit numeric offset
  // (e.g. `+00:00`), matching the shape curl'd against the live backend.
  const toOffsetIso = (date: Date) => date.toISOString().replace('Z', '+00:00');

  const response = await request.post(`${API_BASE_URL}/api/bookings`, {
    data: {
      resourceId: resources[0].id,
      bookedForId: people[0].id,
      purposeId: purposesResponse.purposes[0].id,
      start: toOffsetIso(start),
      end: toOffsetIso(end),
    },
  });
  if (!response.ok()) {
    throw new Error(`seed POST /api/bookings failed with status ${response.status()}`);
  }
  const body = await response.json();
  const booking = body.booking as { id: string; resource: { name: string } };
  bookingIdsToCleanUp.push(booking.id);
  return { booking, resources };
}

test.describe('booking form route (/resources/:resourceId/book)', () => {
  test('AC: resolves for a real resourceId taken from the URL, and renders the current person and purposes loaded through the shared reference-data path', async ({
    page,
    request,
  }) => {
    const liveResources = await fetchLiveResources(request);
    test.skip(liveResources.length === 0, 'requires at least one seeded resource');
    const [resource] = liveResources;

    const me = await (await request.get(`${API_BASE_URL}/api/me`)).json();

    await page.goto(`/resources/${resource.id}/book`);

    // Issue #40 replaced this route's placeholder heading/paragraphs with
    // the real form (`Book <resource name>`, the "Booked for"/"Purpose"
    // selects) — this file only re-asserts the route-wiring/reference-
    // data-loading contract that is still its own scope; the full form is
    // covered by `booking-form.spec.ts`.
    await expect(
      page.getByRole('heading', { level: 1, name: `Book ${resource.name}` }),
    ).toBeVisible();

    await expect(page.getByText(`Booking as ${me.name}.`)).toBeVisible();
  });

  test('AC: the booking form has no automatically detectable accessibility violations', async ({
    page,
    request,
  }) => {
    const liveResources = await fetchLiveResources(request);
    test.skip(liveResources.length === 0, 'requires at least one seeded resource');
    const [resource] = liveResources;

    await page.goto(`/resources/${resource.id}/book`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe('resource schedule → booking form reachability', () => {
  const TEST_DATE = '2026-01-01';

  test('AC: the resource schedule view offers a keyboard-reachable "Book this resource" link that navigates to the booking form for the same resource', async ({
    page,
    request,
  }) => {
    const liveResources = await fetchLiveResources(request);
    test.skip(liveResources.length === 0, 'requires at least one seeded resource');
    const [resource] = liveResources;

    await page.goto(`/resources/${resource.id}/schedule/${TEST_DATE}`);

    const link = page.getByRole('link', { name: 'Book this resource' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', `/resources/${resource.id}/book`);

    // Keyboard path: Tab until the link is focused, then activate with Enter.
    await page.keyboard.press('Tab');
    let guard = 0;
    while (!(await link.evaluate((el) => el === document.activeElement)) && guard < 25) {
      await page.keyboard.press('Tab');
      guard += 1;
    }
    await expect(link).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(`/resources/${resource.id}/book`);
    await expect(
      page.getByRole('heading', { level: 1, name: `Book ${resource.name}` }),
    ).toBeVisible();
  });
});

test.describe('booking confirmation route (/bookings/:id/confirmation)', () => {
  test('AC: resolves a real booking id and renders the confirmed heading', async ({
    page,
    request,
  }) => {
    const { booking } = await createLiveBooking(request);

    await page.goto(`/bookings/${booking.id}/confirmation`);

    await expect(page.getByRole('heading', { level: 1, name: 'Booking confirmed' })).toBeVisible();
    // Issue #42 replaced this route's placeholder body with the real
    // restated-fields rendering (full coverage lives in
    // `booking-confirmation.spec.ts`) — this file only re-asserts
    // route-wiring (a real id resolves to *some* rendered confirmation),
    // via the resource-name field the real render now shows instead of
    // the old placeholder's raw-id text.
    await expect(page.getByRole('definition').filter({ hasText: booking.resource.name })).toBeVisible();
  });

  test('AC: an unknown booking id renders a not-found alert with no stuck loading state and no retry offered', async ({
    page,
  }) => {
    const unknownId = '00000000-0000-0000-0000-000000000000';
    await page.goto(`/bookings/${unknownId}/confirmation`);

    await expect(page.getByRole('heading', { level: 1, name: 'Booking confirmed' })).toBeVisible();

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('This booking no longer exists.');
    await expect(alert.getByRole('button', { name: 'Retry' })).toHaveCount(0);
    await expect(page.getByText('Loading booking…')).toHaveCount(0);
  });
});

test.describe('booking detail route (/bookings/:id)', () => {
  test('AC: resolves a real booking id and renders the detail heading', async ({
    page,
    request,
  }) => {
    const { booking } = await createLiveBooking(request);

    await page.goto(`/bookings/${booking.id}`);

    await expect(page.getByRole('heading', { level: 1, name: 'Booking detail' })).toBeVisible();
    // Issue #41 replaced this route's placeholder body with the real
    // definition-list detail view — assert the "Resource" field instead
    // of the placeholder's raw id text. Full field coverage lives in
    // `booking-detail.spec.ts` (issue #41); this file only re-asserts
    // route-wiring (a real id resolves to *some* rendered detail).
    await expect(page.getByRole('term').filter({ hasText: 'Resource' })).toBeVisible();
    await expect(page.getByRole('definition').filter({ hasText: booking.resource.name })).toBeVisible();
  });

  test('AC: an unknown booking id renders a not-found alert with no stuck loading state and no retry offered', async ({
    page,
  }) => {
    const unknownId = '00000000-0000-0000-0000-000000000000';
    await page.goto(`/bookings/${unknownId}`);

    await expect(page.getByRole('heading', { level: 1, name: 'Booking detail' })).toBeVisible();

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('This booking no longer exists.');
    await expect(alert.getByRole('button', { name: 'Retry' })).toHaveCount(0);
    await expect(page.getByText('Loading booking…')).toHaveCount(0);
  });

  test('AC: a genuine unexpected failure (not a 404) renders the generic failure copy with a working retry, distinct from not-found', async ({
    page,
    request,
  }) => {
    const { booking } = await createLiveBooking(request);

    await page.route('**/api/bookings/*', (route) => route.abort('failed'));
    await page.goto(`/bookings/${booking.id}`);

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(alert).toContainText('The booking could not be loaded.');
    await expect(alert).not.toContainText('no longer exists');
    await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible();

    await page.unroute('**/api/bookings/*');
    await alert.getByRole('button', { name: 'Retry' }).click();

    await expect(alert).not.toBeVisible();
    // See the note above: the placeholder's raw-id text no longer
    // exists after issue #41's real detail rendering.
    await expect(page.getByRole('term').filter({ hasText: 'Resource' })).toBeVisible();
    await expect(page.getByRole('definition').filter({ hasText: booking.resource.name })).toBeVisible();
  });
});
