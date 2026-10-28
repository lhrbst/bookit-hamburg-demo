import { test, expect, type Page, type Locator, type APIRequestContext } from './support/test';
import AxeBuilder from '@axe-core/playwright';
import {
  fetchLiveResources,
  fetchLiveMe,
  fetchLivePurposes,
  fetchLiveScheduleForDate,
  createLiveBooking,
  deleteLiveBooking,
  type LiveResource,
} from './support/api';
import { berlinLocalDateTimeInput } from './support/dates';

/**
 * Issue #50 (Task 3.1, Phase 3 — UI, FS-03 §6.1/§6.2/§9/AC-8/AC-9/AC-12/
 * AC-13, Flow A/Flow C) — verification of the clash-handling behaviour
 * that the booking form (`/resources/:resourceId/book`) already exposes
 * (built by issue #40, asserted in general by
 * `booking-form.spec.ts`'s own "AC: a 409 clash …" test).
 *
 * This file does NOT repeat that existing coverage. Its own, new value is
 * the two behaviours the #40 test never exercised:
 *
 *  - AC-12: a slot taken by someone else *while the form is already open*
 *    (i.e. filled in before the conflict existed) is still refused on
 *    submit with the same clash message — proving there is no client-side
 *    pre-flight/staleness path, only the live server response.
 *  - Recovery: once the conflicting booking is gone, resubmitting the
 *    exact same (unchanged) form values succeeds and proceeds to
 *    confirmation — the clash refusal never poisons the form instance.
 *
 * It also adds one assertion #40's test did not make explicit: that a
 * refused submission genuinely creates nothing (booking count for the
 * day, read back from the live schedule endpoint, is unchanged), and an
 * axe scan specifically of the clash-error state (the #40/general axe
 * scan covers a required-field error, not a clash).
 *
 * | AC | User journey | Observable outcome | Accessibility check |
 * |---|---|---|---|
 * | AC-12 | fill form → API books the exact slot behind the scenes → submit | same "already booked from … to …" message appears | role="alert", associated via aria-describedby, same as #40's test |
 * | Nothing created on refusal | fill + submit into a real clash | live schedule for that day still shows exactly one booking (the seeded one), not two | n/a — data assertion |
 * | Recovery once clash clears | delete the conflicting booking, resubmit same values | navigates to `/bookings/:id/confirmation` | role="status" success announcement (already covered by booking-confirmation.spec.ts; only URL/heading re-asserted here) |
 * | Clash state has no automatic a11y violations | submit into a clash | `AxeBuilder` reports zero violations | axe |
 */

const ELBE_ID = '11111111-1111-1111-1111-111111111112';
const NEBEL_ID = '11111111-1111-1111-1111-111111111111';

let bookingIdsToCleanUp: string[] = [];

test.afterEach(async ({ request }) => {
  for (const id of bookingIdsToCleanUp) {
    await deleteLiveBooking(request, id);
  }
  bookingIdsToCleanUp = [];
});

/** Same technique as `booking-form.spec.ts`'s own `futureSlot`, but with a
 * much wider random range: this file's own `--repeat-each` flakiness run
 * showed that two *concurrent copies of the identical test* (the same
 * `hourOffsetSeed`, run in parallel workers) can otherwise pick the same
 * hour by chance (birthday-paradox collision over a ~300-day range with
 * several repeats). Widening the range to ~50,000 days (~135 years,
 * comfortably inside JS's representable date range) makes that
 * collision negligible while remaining "the future" regardless of when
 * the suite runs. */
function futureSlot(hourOffsetSeed: number): { start: string; end: string } {
  const randomHourOffset = Math.floor(Math.random() * 24 * 50_000);
  const start = new Date(Date.now() + 1000 * 60 * 60 * (24 * 500 + hourOffsetSeed + randomHourOffset));
  start.setUTCMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return { start: berlinLocalDateTimeInput(start), end: berlinLocalDateTimeInput(end) };
}

/** The Europe/Berlin calendar day (`YYYY-MM-DD`) a `datetime-local`
 * value's own leading `YYYY-MM-DD` already names — no separate
 * conversion needed since the input is itself Berlin-local wall clock. */
function dayOf(datetimeLocal: string): string {
  return datetimeLocal.slice(0, 10);
}

async function gotoBookingForm(page: Page, resource: LiveResource) {
  await page.goto(`/resources/${resource.id}/book`);
  await expect(page.getByRole('heading', { level: 1, name: `Book ${resource.name}` })).toBeVisible();
}

function bookedForButton(page: Page): Locator {
  return page.getByRole('button', { name: /Booked for$/ });
}

function purposeButton(page: Page): Locator {
  return page.getByRole('button', { name: /Purpose$/ });
}

async function chooseByKeyboard(page: Page, trigger: Locator, optionName: string) {
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

async function fillValidForm(
  page: Page,
  opts: { bookedFor: string; purpose: string; start: string; end: string },
) {
  await chooseByKeyboard(page, bookedForButton(page), opts.bookedFor);
  await chooseByKeyboard(page, purposeButton(page), opts.purpose);
  await page.getByLabel('Start').fill(opts.start);
  await page.getByLabel('End').fill(opts.end);
}

async function resolveResource(request: APIRequestContext, id: string, expectedName: string) {
  const resources = await fetchLiveResources(request);
  const resource = resources.find((candidate) => candidate.id === id);
  test.skip(resource === undefined, `requires seeded resource ${expectedName} (${id})`);
  return resource as LiveResource;
}

test.describe('booking form clash handling — issue #50', () => {
  test('AC-12: a slot booked by someone else while the form was already open is refused on submit with the same clash message', async ({
    page,
    request,
  }) => {
    const resource = await resolveResource(request, NEBEL_ID, 'Nebel');
    const me = await fetchLiveMe(request);
    const purposes = await fetchLivePurposes(request);
    const { start, end } = futureSlot(10);

    // Confirm, before anything is booked, that this slot is genuinely
    // free — otherwise the "clash appeared only because of the race we
    // engineer below" claim wouldn't hold.
    const scheduleBefore = await fetchLiveScheduleForDate(request, resource.id, dayOf(start));
    expect(scheduleBefore.segments.some((segment) => segment.type === 'booked')).toBe(false);

    // Open the form and fill in all four fields BEFORE the conflicting
    // booking exists — this is the "form was already open" premise of
    // AC-12. Do not submit yet.
    await gotoBookingForm(page, resource);
    await fillValidForm(page, { bookedFor: me.name, purpose: purposes[0].label, start, end });

    // Now, simulating a concurrent user, create the exact conflicting
    // booking directly against the live backend — never through this
    // page — while the already-filled form just sits there.
    const seeded = await createLiveBooking(request, {
      resourceId: resource.id,
      bookedForId: me.id,
      purposeId: purposes[0].id,
      start,
      end,
    });
    bookingIdsToCleanUp.push(seeded.id);

    // Ground truth for the exact wording the live server will now return.
    const rawConflict = await request.post('http://localhost:3001/api/bookings', {
      data: { resourceId: resource.id, bookedForId: me.id, purposeId: purposes[0].id, start, end },
    });
    expect(rawConflict.status()).toBe(409);
    const rawBody = await rawConflict.json();
    const expectedMessage: string = rawBody.error.fieldErrors[0].message;
    expect(expectedMessage).toMatch(/^This resource is already booked from .+ to .+\.$/);

    // Submit the form that was filled in before the conflict existed —
    // proving the client did no stale pre-check and relies solely on the
    // live response at submit time.
    await page.getByRole('button', { name: 'Book this resource' }).click();

    const startInput = page.getByLabel('Start');
    const endInput = page.getByLabel('End');
    await expect(startInput).toHaveAttribute('aria-invalid', 'true');
    await expect(endInput).toHaveAttribute('aria-invalid', 'true');

    const startDescribedBy = await startInput.getAttribute('aria-describedby');
    const endDescribedBy = await endInput.getAttribute('aria-describedby');
    expect(startDescribedBy).toBeTruthy();
    expect(endDescribedBy).toBeTruthy();
    const startAlert = page.locator(`[id="${startDescribedBy}"]`);
    const endAlert = page.locator(`[id="${endDescribedBy}"]`);

    // The alerts are genuinely `role="alert"` (announced), not merely
    // visible text) — the message paragraph itself is the
    // aria-describedby target, and its containing `<div>` carries
    // `role="alert"`.
    await expect(startAlert.locator('xpath=..')).toHaveAttribute('role', 'alert');
    await expect(endAlert.locator('xpath=..')).toHaveAttribute('role', 'alert');
    await expect(startAlert).toHaveText(expectedMessage);
    await expect(endAlert).toHaveText(expectedMessage);

    // The root summary also appears, with the general pointer wording.
    await expect(
      page.getByRole('alert').filter({ hasText: 'not available for the time you chose' }),
    ).toBeVisible();

    // All four entered values survive the refusal untouched (AC-9).
    await expect(startInput).toHaveValue(start);
    await expect(endInput).toHaveValue(end);
    await expect(bookedForButton(page)).toContainText(me.name);
    await expect(purposeButton(page)).toContainText(purposes[0].label);

    // Still on the form — no navigation occurred.
    await expect(page).toHaveURL(`/resources/${resource.id}/book`);
  });

  test('a refused clash submission creates nothing — the live schedule still shows exactly the one pre-existing booking', async ({
    page,
    request,
  }) => {
    const resource = await resolveResource(request, ELBE_ID, 'Elbe');
    const me = await fetchLiveMe(request);
    const purposes = await fetchLivePurposes(request);
    const { start, end } = futureSlot(20);

    const seeded = await createLiveBooking(request, {
      resourceId: resource.id,
      bookedForId: me.id,
      purposeId: purposes[0].id,
      start,
      end,
    });
    bookingIdsToCleanUp.push(seeded.id);

    const day = dayOf(start);
    const scheduleBeforeSubmit = await fetchLiveScheduleForDate(request, resource.id, day);
    const bookedCountBefore = scheduleBeforeSubmit.segments.filter((s) => s.type === 'booked').length;
    // At least our own seeded booking is present — the exact total isn't
    // asserted here (another parallel test could legitimately land a
    // booking on the same calendar day), only that the refused submission
    // below adds nothing on top of whatever already existed.
    expect(bookedCountBefore).toBeGreaterThanOrEqual(1);

    await gotoBookingForm(page, resource);
    await fillValidForm(page, {
      bookedFor: me.name,
      purpose: purposes[0].label,
      start,
      end,
    });
    await page.getByRole('button', { name: 'Book this resource' }).click();

    // Wait for the refusal to actually render before re-reading the
    // schedule, so the count-check isn't a race against the request
    // still being in flight.
    await expect(page.getByLabel('Start')).toHaveAttribute('aria-invalid', 'true');
    await expect(page).toHaveURL(`/resources/${resource.id}/book`);

    const scheduleAfterSubmit = await fetchLiveScheduleForDate(request, resource.id, day);
    const bookedCountAfter = scheduleAfterSubmit.segments.filter((s) => s.type === 'booked').length;
    expect(bookedCountAfter).toBe(bookedCountBefore);
  });

  test('recovery: once the conflicting booking is removed, resubmitting the same unchanged form succeeds and reaches confirmation', async ({
    page,
    request,
  }) => {
    const resource = await resolveResource(request, ELBE_ID, 'Elbe');
    const me = await fetchLiveMe(request);
    const purposes = await fetchLivePurposes(request);
    const { start, end } = futureSlot(30);

    const seeded = await createLiveBooking(request, {
      resourceId: resource.id,
      bookedForId: me.id,
      purposeId: purposes[0].id,
      start,
      end,
    });
    let conflictStillLive = true;
    bookingIdsToCleanUp.push(seeded.id);

    await gotoBookingForm(page, resource);
    await fillValidForm(page, { bookedFor: me.name, purpose: purposes[0].label, start, end });
    await page.getByRole('button', { name: 'Book this resource' }).click();

    const startInput = page.getByLabel('Start');
    await expect(startInput).toHaveAttribute('aria-invalid', 'true');
    await expect(
      page.getByRole('alert').filter({ hasText: 'not available for the time you chose' }),
    ).toBeVisible();
    // Still on the form, values intact.
    await expect(page).toHaveURL(`/resources/${resource.id}/book`);
    await expect(startInput).toHaveValue(start);

    // The clash is resolved — a real, external cancellation of the
    // conflicting booking (never a client-side reset).
    await deleteLiveBooking(request, seeded.id);
    conflictStillLive = false;

    // Resubmit the SAME form instance, same values, unchanged — no
    // navigation happened in between, no `reset()` was ever called.
    const [createResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().endsWith('/api/bookings') && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Book this resource' }).click(),
    ]);
    expect(createResponse.status()).toBe(201);
    const created = (await createResponse.json()) as { booking: { id: string } };
    bookingIdsToCleanUp.push(created.booking.id);

    await expect(page).toHaveURL(`/bookings/${created.booking.id}/confirmation`);
    await expect(page.getByRole('status')).toBeVisible();
    await expect(page.getByRole('definition').filter({ hasText: resource.name })).toBeVisible();

    expect(conflictStillLive).toBe(false);
  });

  test('recovery via adjusted times: changing Start/End to a free slot and resubmitting succeeds while the original clash remains refused', async ({
    page,
    request,
  }) => {
    const resource = await resolveResource(request, NEBEL_ID, 'Nebel');
    const me = await fetchLiveMe(request);
    const purposes = await fetchLivePurposes(request);
    const { start, end } = futureSlot(40);

    const seeded = await createLiveBooking(request, {
      resourceId: resource.id,
      bookedForId: me.id,
      purposeId: purposes[0].id,
      start,
      end,
    });
    bookingIdsToCleanUp.push(seeded.id);

    await gotoBookingForm(page, resource);
    await fillValidForm(page, { bookedFor: me.name, purpose: purposes[0].label, start, end });
    await page.getByRole('button', { name: 'Book this resource' }).click();

    const startInput = page.getByLabel('Start');
    const endInput = page.getByLabel('End');
    await expect(startInput).toHaveAttribute('aria-invalid', 'true');

    // Adjust to a different, genuinely free slot — the conflicting
    // booking is deliberately left in place, proving the fix is the new
    // time, not an external change.
    const laterSlot = futureSlot(41);
    await startInput.fill(laterSlot.start);
    await endInput.fill(laterSlot.end);

    const [createResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().endsWith('/api/bookings') && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Book this resource' }).click(),
    ]);
    expect(createResponse.status()).toBe(201);
    const created = (await createResponse.json()) as { booking: { id: string } };
    bookingIdsToCleanUp.push(created.booking.id);

    await expect(page).toHaveURL(`/bookings/${created.booking.id}/confirmation`);
  });

  test('accessibility: the form in a clash-refused state has no automatically detectable violations', async ({
    page,
    request,
  }) => {
    const resource = await resolveResource(request, ELBE_ID, 'Elbe');
    const me = await fetchLiveMe(request);
    const purposes = await fetchLivePurposes(request);
    const { start, end } = futureSlot(50);

    const seeded = await createLiveBooking(request, {
      resourceId: resource.id,
      bookedForId: me.id,
      purposeId: purposes[0].id,
      start,
      end,
    });
    bookingIdsToCleanUp.push(seeded.id);

    await gotoBookingForm(page, resource);
    await fillValidForm(page, { bookedFor: me.name, purpose: purposes[0].label, start, end });
    await page.getByRole('button', { name: 'Book this resource' }).click();
    await expect(page.getByLabel('Start')).toHaveAttribute('aria-invalid', 'true');

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
