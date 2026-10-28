import { test, expect, type Page, type Locator, type APIRequestContext } from './support/test';
import AxeBuilder from '@axe-core/playwright';
import {
  fetchLiveResources,
  fetchLivePeople,
  fetchLivePurposes,
  fetchLiveMe,
  createLiveBooking,
  deleteLiveBooking,
  type LiveResource,
} from './support/api';
import { todayInBerlin, berlinLocalDateTimeInput } from './support/dates';

/**
 * Issue #40 (Task 3.1, Phase 3 — UI, FS-02 §6.1/FR-1/FR-4/AC-1/AC-7/AC-11,
 * Flow A/Flow C) — the real booking form at
 * `/resources/:resourceId/book`, replacing the issue #39 placeholder
 * asserted in `booking-wiring.spec.ts`.
 *
 * Acceptance criteria covered here (see the plan in this file's PR/report
 * for the full AC → journey → outcome → a11y-check table):
 *  - The resource being booked is visible on the form.
 *  - The booking creator is shown as the current person and cannot be edited.
 *  - Booked-for and purpose are chosen from loaded sets; purpose cannot be free text.
 *  - Submitting a valid form creates the booking and proceeds to confirmation.
 *  - Each backend field error appears beside its own input (AC-3/4/5/5a/7).
 *  - An empty required field is identified specifically, not as a generic failure.
 *  - Abandoning the form creates no booking and leaves no draft record.
 *  - No time-zone control appears anywhere in the form.
 *
 * Fixture resources (from the shared dev seed, `backend/migrations/0003_seed_data.sql`):
 * different resources are used per test below so that tests running in
 * parallel workers never race a real overlap against each other on the
 * SAME resource — only the 409 clash test deliberately engineers a real
 * overlap, and it does so wholly within its own test.
 */

const ELBE_ID = '11111111-1111-1111-1111-111111111112';
const NEBEL_ID = '11111111-1111-1111-1111-111111111111';
const PROJECTOR_ID = '11111111-1111-1111-1111-111111111113';

/** Bookings created by a test, deleted in `afterEach` so the shared
 * Postgres database always returns to its known 5-booking seed state —
 * mirrors `booking-wiring.spec.ts`'s own cleanup convention. */
let bookingIdsToCleanUp: string[] = [];

test.afterEach(async ({ request }) => {
  for (const id of bookingIdsToCleanUp) {
    await deleteLiveBooking(request, id);
  }
  bookingIdsToCleanUp = [];
});

/** A start/end pair guaranteed to be in the future and (via a random
 * offset) unlikely to collide with another parallel test run against the
 * same resource — same technique as `booking-wiring.spec.ts`'s
 * `createLiveBooking`, but producing the bare `YYYY-MM-DDTHH:mm` strings
 * a `datetime-local` input (and the backend) actually expect. */
function futureSlot(hourOffsetSeed: number): { start: string; end: string } {
  const randomHourOffset = Math.floor(Math.random() * 24 * 300);
  const start = new Date(Date.now() + 1000 * 60 * 60 * (24 * 400 + hourOffsetSeed + randomHourOffset));
  start.setUTCMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return { start: berlinLocalDateTimeInput(start), end: berlinLocalDateTimeInput(end) };
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

/** Opens a `FormSelectField` via keyboard (`Enter`) and chooses `optionName`
 * from its listbox via keyboard — typeahead (typing the option's leading
 * characters, a standard listbox keyboard behaviour) jumps the active
 * option to it, then `Enter` commits the selection — never a mouse
 * click, per this suite's keyboard-operability requirement. */
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

/**
 * Presses `Tab` (forward) up to `maxPresses` times until `target` is the
 * focused element — needed because a native `datetime-local` input's
 * internal month/day/year/hour/minute/meridiem segments are each their
 * own `Tab` stop in this browser, so the number of `Tab` presses needed
 * to cross one is not a fixed, portable constant. Mirrors the bounded
 * "Tab until focused" pattern already used in `booking-wiring.spec.ts`.
 */
async function tabUntilFocused(page: Page, target: Locator, maxPresses = 20) {
  for (let i = 0; i < maxPresses; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) {
      return;
    }
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

test.describe('booking form (/resources/:resourceId/book) — issue #40', () => {
  test('AC: the resource being booked is visible on the form', async ({ page, request }) => {
    const resource = await resolveResource(request, ELBE_ID, 'Elbe');

    await gotoBookingForm(page, resource);

    await expect(
      page.getByRole('heading', { level: 1, name: `Book ${resource.name}` }),
    ).toBeVisible();
    await expect(page.getByText(`Booking ${resource.name} (${resource.type}).`)).toBeVisible();
  });

  test('AC: the booking creator is shown as the current person and cannot be edited', async ({
    page,
    request,
  }) => {
    const resource = await resolveResource(request, ELBE_ID, 'Elbe');
    const me = await fetchLiveMe(request);

    await gotoBookingForm(page, resource);

    await expect(page.getByText(`Booking as ${me.name}.`)).toBeVisible();

    // Not editable: no textbox/combobox anywhere in the form is labelled
    // with the current person's name or a generic "creator"/"booked by"
    // label, and the display line is plain text, not an input.
    await expect(page.getByRole('textbox', { name: me.name })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: /booked by|creator/i })).toHaveCount(0);
    await expect(page.getByLabel(/booked by|creator/i)).toHaveCount(0);
  });

  test('AC: "Booked for" and "Purpose" are chosen from loaded sets; purpose cannot be free text', async ({
    page,
    request,
  }) => {
    const resource = await resolveResource(request, ELBE_ID, 'Elbe');
    const people = await fetchLivePeople(request);
    const purposes = await fetchLivePurposes(request);

    await gotoBookingForm(page, resource);

    // "Booked for" is a button (not a textbox) that opens a listbox whose
    // options are exactly the loaded people — never free text entry.
    const bookedFor = bookedForButton(page);
    await expect(bookedFor).toHaveAttribute('aria-haspopup', 'listbox');
    await bookedFor.focus();
    await page.keyboard.press('Enter');
    const bookedForListbox = page.getByRole('listbox');
    await expect(bookedForListbox).toBeVisible();
    for (const person of people) {
      await expect(bookedForListbox.getByRole('option', { name: person.name, exact: true })).toBeVisible();
    }
    await expect(bookedForListbox.getByRole('option')).toHaveCount(people.length);
    await page.keyboard.press('Escape');
    await expect(bookedForListbox).toHaveCount(0);
    // Escape closes without changing the (still-empty) selection.
    await expect(bookedFor).toContainText('Choose a person');

    // "Purpose" is the same pattern with the six purpose labels — and
    // typing an unmatched string (typeahead) never invents a new,
    // free-text option: the listbox option count stays fixed.
    const purpose = purposeButton(page);
    await expect(purpose).toHaveAttribute('aria-haspopup', 'listbox');
    await purpose.focus();
    await page.keyboard.press('Enter');
    const purposeListbox = page.getByRole('listbox');
    await expect(purposeListbox).toBeVisible();
    for (const p of purposes) {
      await expect(purposeListbox.getByRole('option', { name: p.label, exact: true })).toBeVisible();
    }
    await expect(purposeListbox.getByRole('option')).toHaveCount(purposes.length);
    await page.keyboard.type('zzzznotarealoption', { delay: 10 });
    await expect(purposeListbox.getByRole('option')).toHaveCount(purposes.length);
    await page.keyboard.press('Escape');
    await expect(purposeListbox).toHaveCount(0);
    await expect(purpose).toContainText('Choose a purpose');

    // There is genuinely no free-text input for either field anywhere in
    // the form.
    await expect(page.getByRole('textbox', { name: 'Booked for' })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Purpose' })).toHaveCount(0);
  });

  test('AC: submitting a valid form creates the booking and proceeds to confirmation', async ({
    page,
    request,
  }) => {
    const resource = await resolveResource(request, ELBE_ID, 'Elbe');
    const me = await fetchLiveMe(request);
    const purposes = await fetchLivePurposes(request);
    const { start, end } = futureSlot(1);

    await gotoBookingForm(page, resource);
    await fillValidForm(page, { bookedFor: me.name, purpose: purposes[0].label, start, end });

    const [createResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().endsWith('/api/bookings') && res.request().method() === 'POST'),
      page.getByRole('button', { name: 'Book this resource' }).click(),
    ]);
    expect(createResponse.status()).toBe(201);
    const created = (await createResponse.json()) as { booking: { id: string } };
    bookingIdsToCleanUp.push(created.booking.id);

    await expect(page).toHaveURL(`/bookings/${created.booking.id}/confirmation`);
    // Issue #42 built out the real confirmation view (full coverage
    // lives in `booking-confirmation.spec.ts`) — this test only
    // re-asserts that a successful submission actually lands there with
    // the resource restated, via the `<dd>` rather than a loose page-wide
    // text match, since #42 also added a "View <resource>'s schedule"
    // link whose text otherwise makes that loose match ambiguous.
    await expect(page.getByRole('definition').filter({ hasText: resource.name })).toBeVisible();
  });

  test('AC: a 400 field error (end time not after start time) is announced beside the End field, and entered values survive', async ({
    page,
    request,
  }) => {
    const resource = await resolveResource(request, NEBEL_ID, 'Nebel');
    const me = await fetchLiveMe(request);
    const purposes = await fetchLivePurposes(request);
    const { start } = futureSlot(2);
    const end = start; // end === start: backend's own "end-after-start" rule rejects this.

    await gotoBookingForm(page, resource);
    await fillValidForm(page, { bookedFor: me.name, purpose: purposes[0].label, start, end });

    await page.getByRole('button', { name: 'Book this resource' }).click();

    const endInput = page.getByLabel('End');
    await expect(endInput).toHaveAttribute('aria-invalid', 'true');
    const describedBy = await endInput.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const endAlert = page.locator(`[id="${describedBy}"]`);
    await expect(endAlert).toHaveText('The end time must be later than the start time.');
    await expect(page.getByRole('alert').filter({ hasText: 'end time must be later' })).toBeVisible();

    // Values survive the failed submission.
    await expect(page.getByLabel('Start')).toHaveValue(start);
    await expect(endInput).toHaveValue(end);
    await expect(bookedForButton(page)).toContainText(me.name);
    await expect(purposeButton(page)).toContainText(purposes[0].label);

    // Not a generic banner instead of a field-specific message.
    await expect(page.getByRole('alert').filter({ hasText: /^This booking could not be created/ })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: /^Something went wrong/ })).toHaveCount(0);
  });

  test('AC: a 409 clash is announced beside the Start and End fields, states the conflicting time range in business language, and the form keeps its values', async ({
    page,
    request,
  }) => {
    const resource = await resolveResource(request, PROJECTOR_ID, 'Projector Cart A');
    const me = await fetchLiveMe(request);
    const purposes = await fetchLivePurposes(request);
    const { start, end } = futureSlot(3);

    // Seed one real booking directly against the backend (never through
    // the UI) so this test's OWN overlap is deterministic and isolated
    // from any other test.
    const seeded = await createLiveBooking(request, {
      resourceId: resource.id,
      bookedForId: me.id,
      purposeId: purposes[0].id,
      start,
      end,
    });
    bookingIdsToCleanUp.push(seeded.id);

    // Confirm ground truth for the expected wording before asserting the UI.
    const rawConflict = await request.post('http://localhost:3001/api/bookings', {
      data: { resourceId: resource.id, bookedForId: me.id, purposeId: purposes[0].id, start, end },
    });
    expect(rawConflict.status()).toBe(409);
    const rawBody = await rawConflict.json();
    const expectedMessage: string = rawBody.error.fieldErrors[0].message;
    expect(expectedMessage).toMatch(/already booked/i);

    await gotoBookingForm(page, resource);
    await fillValidForm(page, { bookedFor: me.name, purpose: purposes[0].label, start, end });
    await page.getByRole('button', { name: 'Book this resource' }).click();

    const startInput = page.getByLabel('Start');
    const endInput = page.getByLabel('End');
    await expect(startInput).toHaveAttribute('aria-invalid', 'true');
    await expect(endInput).toHaveAttribute('aria-invalid', 'true');

    const startDescribedBy = await startInput.getAttribute('aria-describedby');
    const endDescribedBy = await endInput.getAttribute('aria-describedby');
    const startAlert = page.locator(`[id="${startDescribedBy}"]`);
    const endAlert = page.locator(`[id="${endDescribedBy}"]`);
    await expect(startAlert).toHaveText(expectedMessage);
    await expect(endAlert).toHaveText(expectedMessage);
    expect(expectedMessage).not.toMatch(/^invalid$/i);

    // The refusal is announced (role="alert"), not merely visible text,
    // and the root banner uses clash-specific business language.
    await expect(
      page.getByRole('alert').filter({ hasText: 'not available for the time you chose' }),
    ).toBeVisible();

    // Values survive so another slot can be chosen.
    await expect(startInput).toHaveValue(start);
    await expect(endInput).toHaveValue(end);
  });

  test('AC: an empty required field is identified specifically, with its own message immediately following it — not a generic failure', async ({
    page,
    request,
  }) => {
    const resource = await resolveResource(request, NEBEL_ID, 'Nebel');

    await gotoBookingForm(page, resource);

    // Submit with every required field left empty, reaching the submit
    // button by keyboard alone (bounded Tab walk — see `tabUntilFocused`
    // for why a fixed press-count isn't portable through the datetime
    // inputs' own internal segment stops).
    const submitButton = page.getByRole('button', { name: 'Book this resource' });
    await page.keyboard.press('Tab');
    await tabUntilFocused(page, submitButton);
    await expect(submitButton).toBeFocused();
    await page.keyboard.press('Enter');

    // Four distinct, field-specific messages — no request was ever sent
    // (client-side `required` rules stop it before the network).
    let requestWasSent = false;
    page.on('request', (req) => {
      if (req.url().endsWith('/api/bookings') && req.method() === 'POST') {
        requestWasSent = true;
      }
    });

    const bookedForAlert = page.getByRole('alert').filter({ hasText: 'Choose who this booking is for.' });
    const purposeAlert = page.getByRole('alert').filter({ hasText: 'Choose the purpose of this booking.' });
    const startAlert = page.getByRole('alert').filter({ hasText: 'Enter when the booking starts.' });
    const endAlert = page.getByRole('alert').filter({ hasText: 'Enter when the booking ends.' });
    await expect(bookedForAlert).toBeVisible();
    await expect(purposeAlert).toBeVisible();
    await expect(startAlert).toBeVisible();
    await expect(endAlert).toBeVisible();

    // Each alert is associated with (immediately follows, and is
    // referenced by aria-describedby from) its own specific input/select,
    // never a single detached banner covering all four.
    const bookedForDescribedBy = await bookedForButton(page).getAttribute('aria-describedby');
    expect(bookedForDescribedBy).toBeTruthy();
    await expect(page.locator(`[id="${bookedForDescribedBy}"]`)).toHaveText(
      'Choose who this booking is for.',
    );
    const purposeDescribedBy = await purposeButton(page).getAttribute('aria-describedby');
    expect(purposeDescribedBy).toBeTruthy();
    await expect(page.locator(`[id="${purposeDescribedBy}"]`)).toHaveText(
      'Choose the purpose of this booking.',
    );
    const startDescribedBy = await page.getByLabel('Start').getAttribute('aria-describedby');
    expect(startDescribedBy).toBeTruthy();
    await expect(page.locator(`[id="${startDescribedBy}"]`)).toHaveText('Enter when the booking starts.');
    const endDescribedBy = await page.getByLabel('End').getAttribute('aria-describedby');
    expect(endDescribedBy).toBeTruthy();
    await expect(page.locator(`[id="${endDescribedBy}"]`)).toHaveText('Enter when the booking ends.');

    // No generic "this form is invalid"/save-failed catch-all banner —
    // client-side required validation never reaches the server outcome
    // branch at all.
    await expect(page.getByRole('alert').filter({ hasText: /^Something went wrong/ })).toHaveCount(0);
    await expect(
      page.getByRole('alert').filter({ hasText: /^This booking could not be created/ }),
    ).toHaveCount(0);
    expect(requestWasSent).toBe(false);
  });

  test('AC: abandoning the form (the "Cancel and return to schedule" link, activated by keyboard) creates no booking and leaves no draft record', async ({
    page,
    request,
  }) => {
    const resource = await resolveResource(request, NEBEL_ID, 'Nebel');
    const me = await fetchLiveMe(request);
    const purposes = await fetchLivePurposes(request);
    const { start, end } = futureSlot(4);

    let postWasSent = false;
    await page.route('**/api/bookings', async (route) => {
      if (route.request().method() === 'POST') {
        postWasSent = true;
      }
      await route.continue();
    });

    await gotoBookingForm(page, resource);
    await fillValidForm(page, { bookedFor: me.name, purpose: purposes[0].label, start, end });

    const cancelLink = page.getByRole('link', { name: 'Cancel and return to schedule' });
    await expect(cancelLink).toHaveAttribute('href', `/resources/${resource.id}/schedule/${todayInBerlin()}`);

    // Reach and activate the link by keyboard alone.
    await cancelLink.focus();
    await expect(cancelLink).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(`/resources/${resource.id}/schedule/${todayInBerlin()}`);
    expect(postWasSent).toBe(false);
  });

  test('AC: no time-zone control appears anywhere in the form', async ({ page, request }) => {
    const resource = await resolveResource(request, ELBE_ID, 'Elbe');

    await gotoBookingForm(page, resource);

    await expect(page.getByText(/time.?zone/i)).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: /zone/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /zone/i })).toHaveCount(0);
    await expect(page.getByLabel(/zone/i)).toHaveCount(0);

    // Exactly two datetime entry inputs (Start/End), no accompanying
    // offset/zone selector of any kind.
    await expect(page.locator('input[type="datetime-local"]')).toHaveCount(2);
  });

  test('keyboard operability: the entire form is reachable and operable via Tab and keyboard activation alone', async ({
    page,
    request,
  }) => {
    const resource = await resolveResource(request, ELBE_ID, 'Elbe');
    const people = await fetchLivePeople(request);
    const purposes = await fetchLivePurposes(request);

    await gotoBookingForm(page, resource);

    const bookedFor = bookedForButton(page);
    const purpose = purposeButton(page);
    const startInput = page.getByLabel('Start');
    const endInput = page.getByLabel('End');
    const submitButton = page.getByRole('button', { name: 'Book this resource' });
    const cancelLink = page.getByRole('link', { name: 'Cancel and return to schedule' });

    await page.keyboard.press('Tab'); // Resources nav link
    await page.keyboard.press('Tab'); // Today's bookings nav link
    await page.keyboard.press('Tab');
    await expect(bookedFor).toBeFocused();

    // Open with Space, navigate with the down arrow, select with Enter —
    // opening lands focus on the first option, so one ArrowDown moves to
    // the second.
    await page.keyboard.press('Space');
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(bookedFor).toBeFocused();
    await expect(bookedFor).toContainText(people[1].name);

    await page.keyboard.press('Tab');
    await expect(purpose).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.keyboard.type(purposes[0].label.slice(0, 3), { delay: 20 });
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(purpose).toContainText(purposes[0].label);

    await tabUntilFocused(page, startInput);
    await expect(startInput).toBeFocused();
    // Native `datetime-local` inputs are typeable via keyboard, but their
    // multi-segment (month/day/year/hour/minute/meridiem) editing is a
    // browser-native behaviour outside this app's control and is
    // notoriously inconsistent to drive with raw synthetic keystrokes
    // across headless engines/locales; `fill()` — which sets the value
    // and dispatches a real `input` event, the same contract the field's
    // own `onChange` relies on — is used here as the keyboard-equivalent
    // way to populate it while focused, without ever touching the mouse.
    await startInput.fill('2027-03-01T09:00');
    await expect(startInput).toHaveValue('2027-03-01T09:00');

    await page.keyboard.press('Tab');
    await tabUntilFocused(page, endInput);
    await expect(endInput).toBeFocused();
    await endInput.fill('2027-03-01T10:00');
    await expect(endInput).toHaveValue('2027-03-01T10:00');

    await tabUntilFocused(page, submitButton);
    await expect(submitButton).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(cancelLink).toBeFocused();
  });

  test('accessibility: the loaded booking form has no automatically detectable violations', async ({
    page,
    request,
  }) => {
    const resource = await resolveResource(request, ELBE_ID, 'Elbe');

    await gotoBookingForm(page, resource);
    await expect(bookedForButton(page)).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('accessibility: the form with validation errors visible has no automatically detectable violations', async ({
    page,
    request,
  }) => {
    const resource = await resolveResource(request, ELBE_ID, 'Elbe');

    await gotoBookingForm(page, resource);
    await page.getByRole('button', { name: 'Book this resource' }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
