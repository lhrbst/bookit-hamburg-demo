import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  fetchLiveResources,
  fetchLiveMe,
  fetchLivePurposes,
  createLiveBooking,
  deleteLiveBooking,
  type LiveResource,
} from './support/api';
import { berlinLocalDateTimeInput } from './support/dates';

/**
 * Issue #42 (Task 3.2, Phase 3 — UI, FS-02 §6.2/FR-1/AC-1/AC-11) ACs
 * covered by this file:
 *
 *  - Creation success is stated explicitly in text.
 *  - Resource, date/time range, booking creator, booked-for person and
 *    purpose are all restated.
 *  - Rendered without an additional request after creation (the "no
 *    second fetch" defect this ticket fixed).
 *  - A route back to the availability views is offered.
 *  - Times shown in local time with no time-zone choice.
 *
 * | AC | User journey | Observable outcome | Accessibility check |
 * |---|---|---|---|
 * | Success stated in text | submit a valid form | `role="status"` text present | queried via `getByRole('status')` |
 * | All fields restated | submit a valid form | `<dl>` restates resource/date+time/creator/booked-for/purpose | `getByRole('term'/'definition')` |
 * | No second fetch | submit a valid form | no `GET /api/bookings/:id` fires on the confirmation page load | network monitoring |
 * | Route back offered | submit a valid form | 3 links (schedule/today/detail) navigate correctly | `getByRole('link', {name})` |
 * | Local time, no zone choice | submit a valid form | no zone abbreviation/offset/control anywhere | text-scan + role query |
 * | Fallback (no state) still renders | direct nav to a real id | same restated content, via a `GET` that DOES fire | network monitoring |
 *
 * Fixture resource (from the shared dev seed,
 * `backend/migrations/0003_seed_data.sql`) — a resource not used by
 * `booking-form.spec.ts`'s or `booking-wiring.spec.ts`'s own fixtures for
 * the create-flow test, so parallel workers never race a real overlap on
 * the same resource.
 */
const PROJECTOR_ID = '11111111-1111-1111-1111-111111111113';

let bookingIdsToCleanUp: string[] = [];

test.afterEach(async ({ request }) => {
  for (const id of bookingIdsToCleanUp) {
    await deleteLiveBooking(request, id);
  }
  bookingIdsToCleanUp = [];
});

/** A start/end pair guaranteed to be in the future, offset so parallel
 * workers never collide on the same resource — mirrors
 * `booking-form.spec.ts`'s own `futureSlot` helper. */
function futureSlot(
  hourOffsetSeed: number,
): { start: string; end: string; startIso: string; endIso: string; startLocal: string; endLocal: string } {
  const randomHourOffset = Math.floor(Math.random() * 24 * 300);
  const start = new Date(Date.now() + 1000 * 60 * 60 * (24 * 450 + hourOffsetSeed + randomHourOffset));
  start.setUTCMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    start: berlinLocalDateTimeInput(start),
    end: berlinLocalDateTimeInput(end),
    startIso: start.toISOString().replace('Z', '+00:00'),
    endIso: end.toISOString().replace('Z', '+00:00'),
    // Bare Europe/Berlin local wall-clock strings (`YYYY-MM-DDTHH:mm`,
    // no offset) — the shape `createLiveBooking`'s direct POST (bypassing
    // the `datetime-local` input) must send, mirroring what a real
    // `<input type="datetime-local">` value already is.
    startLocal: berlinLocalDateTimeInput(start),
    endLocal: berlinLocalDateTimeInput(end),
  };
}

async function resolveResource(request: import('@playwright/test').APIRequestContext, id: string, name: string) {
  const resources = await fetchLiveResources(request);
  const resource = resources.find((candidate) => candidate.id === id);
  test.skip(resource === undefined, `requires seeded resource ${name} (${id})`);
  return resource as LiveResource;
}

function bookedForButton(page: Page) {
  return page.getByRole('button', { name: /Booked for$/ });
}

function purposeButton(page: Page) {
  return page.getByRole('button', { name: /Purpose$/ });
}

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

/** Berlin wall-clock date+time formatter matching
 * `frontend/src/lib/dates.ts#formatBerlinDateTime`, independently
 * re-implemented (per this suite's own convention, see
 * `support/dates.ts`) so the test does not just check the app agrees with
 * itself. */
const berlinDateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function formatBerlinDateTime(iso: string): string {
  return berlinDateTimeFormatter.format(new Date(iso));
}

const berlinDayKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function berlinDayKeyOf(iso: string): string {
  return berlinDayKeyFormatter.format(new Date(iso));
}

test.describe('booking confirmation (/bookings/:id/confirmation) — issue #42', () => {
  test('AC: creation success is stated explicitly in text, announced via role="status"', async ({
    page,
    request,
  }) => {
    const resource = await resolveResource(request, PROJECTOR_ID, 'Projector');
    const me = await fetchLiveMe(request);
    const purposes = await fetchLivePurposes(request);
    const { start, end } = futureSlot(1);

    await page.goto(`/resources/${resource.id}/book`);
    await expect(page.getByRole('heading', { level: 1, name: `Book ${resource.name}` })).toBeVisible();

    await chooseByKeyboard(page, bookedForButton(page), me.name);
    await chooseByKeyboard(page, purposeButton(page), purposes[0].label);
    await page.getByLabel('Start').fill(start);
    await page.getByLabel('End').fill(end);

    const [createResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().endsWith('/api/bookings') && res.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Book this resource' }).click(),
    ]);
    expect(createResponse.status()).toBe(201);
    const created = (await createResponse.json()) as { booking: { id: string } };
    bookingIdsToCleanUp.push(created.booking.id);

    await expect(page).toHaveURL(`/bookings/${created.booking.id}/confirmation`);
    await expect(page.getByRole('heading', { level: 1, name: 'Booking confirmed' })).toBeVisible();

    const status = page.getByRole('status');
    await expect(status).toBeVisible();
    await expect(status).toHaveText(
      'Booking created. Your booking has been confirmed — the details below are what was reserved.',
    );
  });

  test('AC: resource, date/time range, booking creator, booked-for person and purpose are all restated, and no second GET request fires', async ({
    page,
    request,
  }) => {
    const resource = await resolveResource(request, PROJECTOR_ID, 'Projector');
    const me = await fetchLiveMe(request);
    const purposes = await fetchLivePurposes(request);
    const { start, end, startIso, endIso } = futureSlot(2);

    await page.goto(`/resources/${resource.id}/book`);
    await expect(page.getByRole('heading', { level: 1, name: `Book ${resource.name}` })).toBeVisible();

    await chooseByKeyboard(page, bookedForButton(page), me.name);
    await chooseByKeyboard(page, purposeButton(page), purposes[0].label);
    await page.getByLabel('Start').fill(start);
    await page.getByLabel('End').fill(end);

    // Network monitoring: the core regression assertion for the "second
    // fetch" defect this ticket fixed. Only the create POST may fire
    // against /api/bookings(/...) for the rest of this test — no GET to
    // the per-id detail endpoint.
    const bookingsRequests: { method: string; url: string }[] = [];
    page.on('request', (req) => {
      if (/\/api\/bookings(\/|$|\?)/.test(req.url())) {
        bookingsRequests.push({ method: req.method(), url: req.url() });
      }
    });

    const [createResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().endsWith('/api/bookings') && res.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Book this resource' }).click(),
    ]);
    expect(createResponse.status()).toBe(201);
    const created = (await createResponse.json()) as { booking: { id: string } };
    bookingIdsToCleanUp.push(created.booking.id);

    await expect(page).toHaveURL(`/bookings/${created.booking.id}/confirmation`);

    // Whole `<dl>` in one assertion proves presence AND order of all five
    // restated fields, per this suite's own established pattern
    // (`booking-detail.spec.ts`).
    const dateTimeText = `${formatBerlinDateTime(startIso)} – ${formatBerlinDateTime(endIso)}`;
    await expect(page.locator('dl')).toMatchAriaSnapshot(`
      - term: Resource
      - definition: ${resource.name}
      - term: Date and time
      - definition: ${dateTimeText}
      - term: Booked by
      - definition: ${me.name}
      - term: Booked for
      - definition: ${me.name}
      - term: Purpose
      - definition: ${purposes[0].label}
    `);

    // Give any stray fetch a moment to have shown up in the listener
    // above before asserting the network trace is exactly the one POST.
    await expect(page.getByRole('status')).toBeVisible();
    const getBookingRequests = bookingsRequests.filter(
      (r) => r.method === 'GET' && /\/api\/bookings\/[^/?]+$/.test(r.url),
    );
    expect(getBookingRequests, JSON.stringify(bookingsRequests)).toHaveLength(0);
  });

  test('AC: a route back to the availability views is offered, as three working links', async ({
    page,
    request,
  }) => {
    const resource = await resolveResource(request, PROJECTOR_ID, 'Projector');
    const me = await fetchLiveMe(request);
    const purposes = await fetchLivePurposes(request);
    const { start, end, startIso } = futureSlot(3);

    await page.goto(`/resources/${resource.id}/book`);
    await chooseByKeyboard(page, bookedForButton(page), me.name);
    await chooseByKeyboard(page, purposeButton(page), purposes[0].label);
    await page.getByLabel('Start').fill(start);
    await page.getByLabel('End').fill(end);

    const [createResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().endsWith('/api/bookings') && res.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Book this resource' }).click(),
    ]);
    const created = (await createResponse.json()) as { booking: { id: string } };
    bookingIdsToCleanUp.push(created.booking.id);
    await expect(page).toHaveURL(`/bookings/${created.booking.id}/confirmation`);

    const dayKey = berlinDayKeyOf(startIso);

    const scheduleLink = page.getByRole('link', { name: `View ${resource.name}’s schedule` });
    const todayLink = page.getByRole('link', { name: "View today’s overview" });
    const detailLink = page.getByRole('link', { name: 'View booking detail' });

    await expect(scheduleLink).toHaveAttribute('href', `/resources/${resource.id}/schedule/${dayKey}`);
    await expect(todayLink).toHaveAttribute('href', '/today');
    await expect(detailLink).toHaveAttribute('href', `/bookings/${created.booking.id}`);

    // Keyboard-driven activation of one of them proves the "route offered"
    // is genuinely reachable, not merely present in the DOM.
    await detailLink.focus();
    await expect(detailLink).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`/bookings/${created.booking.id}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Booking detail' })).toBeVisible();

    // Go back and prove the other two links navigate too.
    await page.goBack();
    await expect(page).toHaveURL(`/bookings/${created.booking.id}/confirmation`);
    await page.getByRole('link', { name: 'View today’s overview' }).click();
    await expect(page).toHaveURL('/today');

    await page.goBack();
    await expect(page).toHaveURL(`/bookings/${created.booking.id}/confirmation`);
    await page
      .getByRole('link', { name: `View ${resource.name}’s schedule` })
      .click();
    await expect(page).toHaveURL(`/resources/${resource.id}/schedule/${dayKey}`);
  });

  test('AC: times are shown in Berlin local time with no time-zone abbreviation, offset, or choice offered', async ({
    page,
    request,
  }) => {
    const resource = await resolveResource(request, PROJECTOR_ID, 'Projector');
    const me = await fetchLiveMe(request);
    const purposes = await fetchLivePurposes(request);
    const { start, end } = futureSlot(4);

    await page.goto(`/resources/${resource.id}/book`);
    await chooseByKeyboard(page, bookedForButton(page), me.name);
    await chooseByKeyboard(page, purposeButton(page), purposes[0].label);
    await page.getByLabel('Start').fill(start);
    await page.getByLabel('End').fill(end);

    const [createResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().endsWith('/api/bookings') && res.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Book this resource' }).click(),
    ]);
    const created = (await createResponse.json()) as { booking: { id: string } };
    bookingIdsToCleanUp.push(created.booking.id);
    await expect(page).toHaveURL(`/bookings/${created.booking.id}/confirmation`);

    const bodyText = await page.locator('body').innerText();
    for (const marker of ['UTC', 'GMT', 'CEST', 'CET', '+02:00', '+00:00', 'Z ']) {
      expect(bodyText).not.toContain(marker);
    }
    await expect(page.getByRole('combobox', { name: /time.?zone/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /time.?zone/i })).toHaveCount(0);
  });

  test('AC: the confirmation view has no automatically detectable accessibility violations', async ({
    page,
    request,
  }) => {
    const resource = await resolveResource(request, PROJECTOR_ID, 'Projector');
    const me = await fetchLiveMe(request);
    const purposes = await fetchLivePurposes(request);
    const { start, end } = futureSlot(5);

    await page.goto(`/resources/${resource.id}/book`);
    await chooseByKeyboard(page, bookedForButton(page), me.name);
    await chooseByKeyboard(page, purposeButton(page), purposes[0].label);
    await page.getByLabel('Start').fill(start);
    await page.getByLabel('End').fill(end);

    const [createResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().endsWith('/api/bookings') && res.request().method() === 'POST',
      ),
      page.getByRole('button', { name: 'Book this resource' }).click(),
    ]);
    const created = (await createResponse.json()) as { booking: { id: string } };
    bookingIdsToCleanUp.push(created.booking.id);
    await expect(page).toHaveURL(`/bookings/${created.booking.id}/confirmation`);
    await expect(page.getByRole('status')).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe('booking confirmation fallback (direct/bookmarked navigation, no router state) — issue #42', () => {
  test('AC: a real booking id reached directly (no router state) still renders success text and all restated fields, via a fallback GET that fires', async ({
    page,
    request,
  }) => {
    const resource = await resolveResource(request, PROJECTOR_ID, 'Projector');
    const me = await fetchLiveMe(request);
    const purposes = await fetchLivePurposes(request);
    const { startIso, endIso, startLocal, endLocal } = futureSlot(6);

    const booking = await createLiveBooking(request, {
      resourceId: resource.id,
      bookedForId: me.id,
      purposeId: purposes[0].id,
      start: startLocal,
      end: endLocal,
    });
    bookingIdsToCleanUp.push(booking.id);

    const getBookingRequests: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'GET' && new RegExp(`/api/bookings/${booking.id}$`).test(req.url())) {
        getBookingRequests.push(req.url());
      }
    });

    // Direct navigation: no `state` is attached, exercising the fallback
    // `getBooking` query path (never reachable from the create flow
    // itself).
    await page.goto(`/bookings/${booking.id}/confirmation`);

    await expect(page.getByRole('heading', { level: 1, name: 'Booking confirmed' })).toBeVisible();
    await expect(page.getByRole('status')).toHaveText(
      'Booking created. Your booking has been confirmed — the details below are what was reserved.',
    );

    const dateTimeText = `${formatBerlinDateTime(startIso)} – ${formatBerlinDateTime(endIso)}`;
    await expect(page.locator('dl')).toMatchAriaSnapshot(`
      - term: Resource
      - definition: ${resource.name}
      - term: Date and time
      - definition: ${dateTimeText}
      - term: Booked by
      - definition: ${me.name}
      - term: Booked for
      - definition: ${me.name}
      - term: Purpose
      - definition: ${purposes[0].label}
    `);

    await expect
      .poll(() => getBookingRequests.length, {
        message: 'expected the fallback GET /api/bookings/:id to fire for a direct navigation',
      })
      .toBeGreaterThan(0);
  });

  test('AC: an unknown booking id (fallback path) renders a not-found alert with no stuck loading state and no retry offered', async ({
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
    // Success text must never appear alongside a not-found outcome.
    await expect(page.getByRole('status')).toHaveCount(0);
  });

  test('AC: a genuine unexpected failure (not a 404) on the fallback path renders generic failure copy with a working retry', async ({
    page,
    request,
  }) => {
    const resource = await resolveResource(request, PROJECTOR_ID, 'Projector');
    const me = await fetchLiveMe(request);
    const purposes = await fetchLivePurposes(request);
    const { startLocal, endLocal } = futureSlot(7);

    const booking = await createLiveBooking(request, {
      resourceId: resource.id,
      bookedForId: me.id,
      purposeId: purposes[0].id,
      start: startLocal,
      end: endLocal,
    });
    bookingIdsToCleanUp.push(booking.id);

    await page.route('**/api/bookings/*', (route) => route.abort('failed'));
    await page.goto(`/bookings/${booking.id}/confirmation`);

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(alert).toContainText('The booking could not be loaded.');
    await expect(alert).not.toContainText('no longer exists');
    await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);

    await page.unroute('**/api/bookings/*');
    await alert.getByRole('button', { name: 'Retry' }).click();

    await expect(alert).not.toBeVisible();
    await expect(page.getByRole('status')).toBeVisible();
    await expect(page.getByRole('definition').filter({ hasText: resource.name })).toBeVisible();
  });
});
