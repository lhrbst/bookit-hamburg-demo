import { test, expect, type Page, type Locator } from './support/test';
import {
  fetchLiveScheduleForDate,
  fetchLiveResources,
  fetchLivePeople,
  fetchLivePurposes,
  fetchLiveMe,
  createLiveBooking,
  deleteLiveBooking,
  type LiveResource,
  type LiveScheduleSegment,
} from './support/api';
import { formatBerlinTime } from './support/dates';

/**
 * Issue #45 (Task 4.1, Phase 4 — Cross-cutting, FS-02 §9/AC-12)
 * accessibility AUDIT of the whole FS-02 write flow (form → confirmation
 * → detail → cancel), extending the FS-01 conventions from #31.
 *
 * Almost every acceptance criterion below was already satisfied by prior
 * tickets and is already covered, view-by-view, by `booking-form.spec.ts`
 * (#40), `booking-confirmation.spec.ts` (#42), `booking-detail.spec.ts`
 * (#41) and `cancel-booking-dialog.spec.ts` (#43) — this file does NOT
 * repeat that isolated coverage. Its own, new value is the single genuine
 * gap this ticket found and fixed (no post-navigation focus management
 * anywhere — `useFocusHeadingOnNavigate`, `frontend/src/App.tsx`) and the
 * fact that NO existing test walks the entire journey continuously,
 * asserting focus at every screen transition along the way.
 *
 * | AC | User journey | Observable outcome | Accessibility check |
 * |---|---|---|---|
 * | Entire flow completable keyboard-only | schedule → form → submit → confirmation → detail → cancel dialog → confirm | every step reached/activated via Tab/Enter only, ending with the booking gone | no `.click()` anywhere in the journey test |
 * | Focus lands sensibly at each transition | same journey | the new screen's own `<h1>` (or, for the dialog, the dialog itself) is the focused element right after each navigation | `toBeFocused()` at each hop |
 * | Creation success announced | successful submit | confirmation `<h1>` focused AND `role="status"` text present | `getByRole('status')` |
 * | Cancellation success announced | confirm cancel | `role="status"` text present, dialog gone | `getByRole('status')` |
 * | Dialog manages focus / dismissible without cancelling | open dialog, Tab through it | focus starts inside the dialog and Tabbing never escapes to the page behind it | regression-style check reusing #43's own technique |
 *
 * Fixture: a resource + a far-future Europe/Berlin calendar day
 * confirmed via the live schedule endpoint to be genuinely free all day
 * (offset ~5000+ days out — well beyond every other spec file's own
 * far-future fixture range, so this test's whole-day "currently free"
 * assumption is never invalidated by another spec's fixture landing on
 * the same day) — this journey creates exactly one real booking and
 * cancels it again itself as its own last step, so the shared 5-booking
 * seed is left exactly as found even if the test fails partway (the
 * `afterEach` below still deletes it defensively).
 */

const PROJECTOR_ID = '11111111-1111-1111-1111-111111111113';
const PROJECTOR_NAME = 'Projector Cart A';

let bookingIdToCleanUp: string | null = null;

test.afterEach(async ({ request }) => {
  if (bookingIdToCleanUp !== null) {
    await deleteLiveBooking(request, bookingIdToCleanUp);
    bookingIdToCleanUp = null;
  }
});

function farFutureBerlinDate(dayOffset: number): string {
  const instant = new Date(Date.now() + dayOffset * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Finds a calendar day, starting at a randomised ~5000+ days out and
 * walking forward one day at a time, on which the given resource's live
 * schedule is genuinely free all day (no `booked` segment at all) —
 * robust to any other suite ever seeding a fixture in this already-remote
 * range. The random starting offset (rather than a fixed one) also keeps
 * two concurrent runs of THIS SAME test (parallel workers, or repeated
 * runs) from landing on the identical day and racing each other for the
 * identical slot. */
async function findGenuinelyFreeDay(
  request: import('@playwright/test').APIRequestContext,
  resourceId: string,
): Promise<{ date: string; freeSegment: LiveScheduleSegment }> {
  const base = 5000 + Math.floor(Math.random() * 5000);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const date = farFutureBerlinDate(base + attempt);
    const schedule = await fetchLiveScheduleForDate(request, resourceId, date);
    const hasBooked = schedule.segments.some((s) => s.type === 'booked');
    if (!hasBooked && schedule.segments.length > 0) {
      return { date, freeSegment: schedule.segments[0] };
    }
  }
  throw new Error('could not find a genuinely free day for the fixture resource in the probed range');
}

/** A random `HH:00`–`(HH+1):00` hour pair inside a genuinely-free day
 * (`02:00`–`21:00`, safely clear of the day's own 00:00/24:00 boundary so
 * the value is never ambiguous), so two concurrent runs of this same
 * test picking the same day (a low-probability but possible collision
 * given {@link findGenuinelyFreeDay}'s own randomisation) still do not
 * race for the identical time slot. */
function randomHourSlot(date: string): { start: string; end: string } {
  const startHour = 2 + Math.floor(Math.random() * 19);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    start: `${date}T${pad(startHour)}:00`,
    end: `${date}T${pad(startHour + 1)}:00`,
  };
}

function segmentTimeRange(segment: LiveScheduleSegment): string {
  return `${formatBerlinTime(segment.start)}–${formatBerlinTime(segment.end)}`;
}

/** Presses `Tab` from wherever focus currently is until `target` becomes
 * the focused element, or `maxPresses` is reached — same bounded pattern
 * already used by `booking-form.spec.ts`/`booking-navigation.spec.ts`. */
async function tabUntilFocused(page: Page, target: Locator, maxPresses = 30) {
  for (let i = 0; i < maxPresses; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) {
      return;
    }
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

/** Opens a `FormSelectField` via keyboard and chooses `optionName` from
 * its listbox via keyboard typeahead — identical technique to
 * `booking-form.spec.ts`'s own `chooseByKeyboard`, reimplemented here
 * rather than imported since that file does not export it. */
async function chooseByKeyboard(page: Page, trigger: Locator, optionName: string) {
  await tabUntilFocused(page, trigger);
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

test.describe('FS-02 write-flow continuous accessibility journey (issue #45)', () => {
  test('AC-12: the entire booking flow — schedule, form, submit, confirmation, detail, cancel, confirm, dismiss — is completable keyboard-only, with focus landing on each new screen', async ({
    page,
    request,
  }) => {
    const people = await fetchLivePeople(request);
    const purposes = await fetchLivePurposes(request);
    test.skip(people.length === 0 || purposes.length === 0, 'requires seeded people and purposes');

    const { date, freeSegment } = await findGenuinelyFreeDay(request, PROJECTOR_ID);
    const timeRange = segmentTimeRange(freeSegment);

    // --- 1. Resource schedule: free slot link, reached and activated by keyboard alone ---
    await page.goto(`/resources/${PROJECTOR_ID}/schedule/${date}`);
    await expect(
      page.getByRole('heading', { level: 1, name: `Schedule for resource ${PROJECTOR_ID} on ${date}` }),
    ).toBeVisible();

    const freeSlotLink = page.getByRole('link', {
      name: `Book this free slot, ${timeRange}`,
      exact: true,
    });
    await expect(freeSlotLink).toBeVisible();
    await tabUntilFocused(page, freeSlotLink, 60);
    await expect(freeSlotLink).toBeFocused();
    await page.keyboard.press('Enter');

    // --- 2. Booking form: focus lands on its own <h1> after the navigation ---
    await expect(page).toHaveURL(`/resources/${PROJECTOR_ID}/book`);
    const formHeading = page.getByRole('heading', { level: 1, name: `Book ${PROJECTOR_NAME}` });
    await expect(formHeading).toBeVisible();
    await expect(formHeading).toBeFocused();

    // --- 3. Fill the entire form via keyboard only ---
    const bookedForButton = page.getByRole('button', { name: /Booked for$/ });
    const purposeButton = page.getByRole('button', { name: /Purpose$/ });
    await chooseByKeyboard(page, bookedForButton, people[0].name);
    await chooseByKeyboard(page, purposeButton, purposes[0].label);

    const startInput = page.getByLabel('Start');
    const endInput = page.getByLabel('End');
    const { start: startValue, end: endValue } = randomHourSlot(date);
    await tabUntilFocused(page, startInput);
    await startInput.fill(startValue);
    await expect(startInput).toHaveValue(startValue);
    await tabUntilFocused(page, endInput);
    await endInput.fill(endValue);
    await expect(endInput).toHaveValue(endValue);

    const submitButton = page.getByRole('button', { name: 'Book this resource' });
    await tabUntilFocused(page, submitButton);

    const [createResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().endsWith('/api/bookings') && res.request().method() === 'POST',
      ),
      page.keyboard.press('Enter'),
    ]);
    expect(createResponse.status()).toBe(201);
    const createdBody = await createResponse.json();
    const bookingId: string = createdBody.booking.id;
    bookingIdToCleanUp = bookingId;

    // --- 4. Confirmation: focus lands on its own <h1>, success is announced ---
    await expect(page).toHaveURL(`/bookings/${bookingId}/confirmation`);
    const confirmationHeading = page.getByRole('heading', { level: 1, name: 'Booking confirmed' });
    await expect(confirmationHeading).toBeVisible();
    await expect(confirmationHeading).toBeFocused();

    const creationStatus = page.getByRole('status');
    await expect(creationStatus).toHaveText(
      'Booking created. Your booking has been confirmed — the details below are what was reserved.',
    );

    // --- 5. Detail: reached and activated by keyboard alone, focus lands on its own <h1> ---
    const detailLink = page.getByRole('link', { name: 'View booking detail' });
    await tabUntilFocused(page, detailLink);
    await expect(detailLink).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(`/bookings/${bookingId}`);
    const detailHeading = page.getByRole('heading', { level: 1, name: 'Booking detail' });
    await expect(detailHeading).toBeVisible();
    await expect(detailHeading).toBeFocused();

    // --- 6. Cancel dialog: opened by keyboard, focus moves INTO it (a specific element, not merely "visible") ---
    const cancelTrigger = page.getByRole('button', { name: 'Cancel booking' });
    await tabUntilFocused(page, cancelTrigger);
    await expect(cancelTrigger).toBeFocused();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: `Cancel booking: ${PROJECTOR_NAME}` });
    await expect(dialog).toBeVisible();
    // React Aria's `Dialog` places initial focus on the dialog container
    // itself (confirmed against the live app before writing this
    // assertion) — a specific, provable focus target, not a loose
    // "somewhere inside" check.
    await expect(dialog).toBeFocused();

    // --- 7. Focus trap: repeated Tabs only ever cycle the dialog's own two buttons, never escape to the page behind it ---
    const confirmButton = dialog.getByRole('button', { name: 'Yes, cancel it' });
    const keepButton = dialog.getByRole('button', { name: 'No, keep it' });
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab');
      const focusedIsInsideDialog = await page.evaluate(() => {
        const active = document.activeElement;
        return active !== null && (active.textContent === 'Yes, cancel it' || active.textContent === 'No, keep it');
      });
      expect(focusedIsInsideDialog).toBe(true);
    }
    await expect(page.getByRole('link', { name: 'Resources' })).not.toBeFocused();
    await expect(detailHeading).not.toBeFocused();
    // Sanity: both of the dialog's own buttons are genuinely reachable
    // (the loop above proves the trap, not that either button exists).
    await confirmButton.focus();
    await expect(confirmButton).toBeFocused();
    await keepButton.focus();
    await expect(keepButton).toBeFocused();

    // --- 8. Dismiss without cancelling (Escape), proving the dialog can be backed out of ---
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(cancelTrigger).toBeFocused();
    // Backing out did not cancel the booking.
    const getAfterEscape = await request.get(`http://localhost:3001/api/bookings/${bookingId}`);
    expect(getAfterEscape.status()).toBe(200);

    // --- 9. Re-open and confirm cancellation via keyboard, success announced ---
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await tabUntilFocused(page, confirmButton);
    await expect(confirmButton).toBeFocused();
    await page.keyboard.press('Enter');

    const cancellationStatus = page.getByRole('status');
    await expect(cancellationStatus).toHaveText('This booking has been cancelled.');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);

    // Net DB effect is zero: the booking this journey created is now gone.
    const getAfterCancel = await request.get(`http://localhost:3001/api/bookings/${bookingId}`);
    expect(getAfterCancel.status()).toBe(404);
    bookingIdToCleanUp = null; // already gone — afterEach's delete would be a harmless no-op, but nothing to do
  });
});

/**
 * Editorial spot-check (issue #45's own remit — "error text says both the
 * problem and the remedy" is a plain-language judgement call, not just a
 * wiring check): asserts the EXACT rendered text of one message from each
 * of the four error sources the booking form surfaces, so a reviewer can
 * read this file and judge the wording without re-deriving it from the
 * component/backend source. See this ticket's own report for the
 * clarity judgement on each.
 */
const ELBE_ID = '11111111-1111-1111-1111-111111111112';
const PROJECTOR_CART_A_ID = '11111111-1111-1111-1111-111111111113';

let clashBookingIdToCleanUp: string | null = null;

test.afterEach(async ({ request }) => {
  if (clashBookingIdToCleanUp !== null) {
    await deleteLiveBooking(request, clashBookingIdToCleanUp);
    clashBookingIdToCleanUp = null;
  }
});

async function resolveResource(
  request: import('@playwright/test').APIRequestContext,
  id: string,
): Promise<LiveResource> {
  const resources = await fetchLiveResources(request);
  const resource = resources.find((candidate) => candidate.id === id);
  test.skip(resource === undefined, `requires seeded resource ${id}`);
  return resource as LiveResource;
}

/** A start/end pair far enough out (~7000+ days, well beyond every other
 * spec file's own far-future range including this file's own journey
 * test above) to be both safely in the future and collision-free. */
function farFutureSlot(hourOffsetSeed: number): { start: string; end: string } {
  const randomHourOffset = Math.floor(Math.random() * 24 * 300);
  const start = new Date(Date.now() + 1000 * 60 * 60 * (24 * 7000 + hourOffsetSeed + randomHourOffset));
  start.setUTCMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const toLocalInput = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Berlin',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(d)
      .reduce((acc, part) => (part.type === 'literal' ? acc : { ...acc, [part.type]: part.value }), {} as Record<string, string>);
  const format = (d: Date) => {
    const p = toLocalInput(d);
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  };
  return { start: format(start), end: format(end) };
}

test.describe('FS-02 error-message clarity spot-check (issue #45)', () => {
  test('spot-check: a native-required field, a FormSelectField-required field, a 400 field error, and a 409 clash each state their exact wording', async ({
    page,
    request,
  }) => {
    const resource = await resolveResource(request, ELBE_ID);
    const me = await fetchLiveMe(request);
    const purposes = await fetchLivePurposes(request);

    // --- 1. Native-required field: Start left empty ---
    await page.goto(`/resources/${resource.id}/book`);
    await expect(page.getByRole('heading', { level: 1, name: `Book ${resource.name}` })).toBeVisible();
    await page.getByRole('button', { name: 'Book this resource' }).click();

    const startInput = page.getByLabel('Start');
    await expect(startInput).toHaveAttribute('aria-invalid', 'true');
    const startDescribedBy = await startInput.getAttribute('aria-describedby');
    const startMessage = page.locator(`[id="${startDescribedBy}"]`);
    await expect(startMessage).toHaveText('Enter when the booking starts.');

    // --- 2. FormSelectField-required field: "Booked for" left unselected ---
    // (React Aria's `Select` associates the error via `aria-describedby`
    // on its trigger button — it does not also mirror `aria-invalid`
    // there, unlike the native `datetime-local` inputs above/below, which
    // do; confirmed against the live app before writing this assertion.)
    const bookedForButton = page.getByRole('button', { name: /Booked for$/ });
    const bookedForDescribedBy = await bookedForButton.getAttribute('aria-describedby');
    const bookedForMessage = page.locator(`[id="${bookedForDescribedBy}"]`);
    await expect(bookedForMessage).toHaveText('Choose who this booking is for.');

    // --- 3. Backend 400 field error: end time not after start time ---
    const bothPassOffset = 4;
    const { start } = farFutureSlot(bothPassOffset);
    const end = start; // end === start deliberately triggers the end-after-start rule.

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: `Book ${resource.name}` })).toBeVisible();
    const purposeButton = page.getByRole('button', { name: /Purpose$/ });
    await bookedForButton.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('option', { name: me.name, exact: true }).click();
    await purposeButton.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('option', { name: purposes[0].label, exact: true }).click();
    await page.getByLabel('Start').fill(start);
    await page.getByLabel('End').fill(end);
    await page.getByRole('button', { name: 'Book this resource' }).click();

    const endInput = page.getByLabel('End');
    await expect(endInput).toHaveAttribute('aria-invalid', 'true');
    const endDescribedBy = await endInput.getAttribute('aria-describedby');
    const endMessage = page.locator(`[id="${endDescribedBy}"]`);
    await expect(endMessage).toHaveText('The end time must be later than the start time.');

    // --- 4. Backend 409 clash: submit a booking overlapping an existing one ---
    const projectorResource = await resolveResource(request, PROJECTOR_CART_A_ID);
    const clashOffset = 9;
    const { start: clashStart, end: clashEnd } = farFutureSlot(clashOffset);
    const seeded = await createLiveBooking(request, {
      resourceId: projectorResource.id,
      bookedForId: me.id,
      purposeId: purposes[0].id,
      start: clashStart,
      end: clashEnd,
    });
    clashBookingIdToCleanUp = seeded.id;

    await page.goto(`/resources/${projectorResource.id}/book`);
    await expect(
      page.getByRole('heading', { level: 1, name: `Book ${projectorResource.name}` }),
    ).toBeVisible();
    const clashBookedForButton = page.getByRole('button', { name: /Booked for$/ });
    const clashPurposeButton = page.getByRole('button', { name: /Purpose$/ });
    await clashBookedForButton.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('option', { name: me.name, exact: true }).click();
    await clashPurposeButton.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('option', { name: purposes[0].label, exact: true }).click();
    await page.getByLabel('Start').fill(clashStart);
    await page.getByLabel('End').fill(clashEnd);
    await page.getByRole('button', { name: 'Book this resource' }).click();

    const clashStartInput = page.getByLabel('Start');
    await expect(clashStartInput).toHaveAttribute('aria-invalid', 'true');
    const clashDescribedBy = await clashStartInput.getAttribute('aria-describedby');
    const clashMessage = page.locator(`[id="${clashDescribedBy}"]`);
    // The exact conflicting range, in business language — not a generic
    // "clash" or a raw code — derived from the seeded booking's own
    // Berlin-local datetime string (`YYYY-MM-DD HH:MM`, the backend's own
    // `formatBerlin`) so this is provable without hand-computing the
    // formatting.
    const startLocal = clashStart.replace('T', ' ');
    const endLocal = clashEnd.replace('T', ' ');
    await expect(clashMessage).toHaveText(
      `This resource is already booked from ${startLocal} to ${endLocal}.`,
    );
  });
});
