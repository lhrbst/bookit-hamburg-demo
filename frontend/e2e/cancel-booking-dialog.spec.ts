import { test, expect } from './support/test';
import AxeBuilder from '@axe-core/playwright';
import {
  fetchLiveResources,
  fetchLivePeople,
  fetchLivePurposes,
  createLiveBooking,
  deleteLiveBooking,
} from './support/api';
import { formatBerlinDateTime, berlinLocalDateTimeInput } from './support/dates';

/**
 * Issue #43 (Task 3.4, Phase 3 — UI, FS-02 §6.4/FR-3/AC-8/AC-10/Flow B)
 * ACs covered by this file — the app's first real modal dialog
 * (`CancelBookingDialog`, built on React Aria Components'
 * `DialogTrigger`/`ModalOverlay`/`Modal`/`Dialog`):
 *
 *  - "No booking is cancelled without an explicit confirmation step."
 *  - "The confirmation names the specific booking by resource and time
 *    range."
 *  - "Backing out leaves the booking unchanged (AC-10)" — via Escape, the
 *    underlay, and the "No, keep it" button.
 *  - "Successful cancellation is confirmed in text (AC-8)" — announced,
 *    not merely rendered.
 *  - "Confirming twice, or confirming an already-removed booking, does
 *    not produce a duplicate destructive call."
 *
 * `booking-detail.spec.ts` (issue #41) already covers the trigger
 * button's own presence/absence rules (server-derived `canCancel`) and
 * the *placeholder* seam issue #41 left behind — this file supersedes
 * only the placeholder-specific assertions that placeholder no longer
 * exists (the real dialog owns "opens a confirmation instead of
 * cancelling immediately" now) and adds full dialog-specific coverage:
 * focus trapping, focus restoration, Escape/underlay dismissal, the
 * live-region success announcement, the generic-failure path, and the
 * double-confirm/already-gone race.
 *
 * Every test creates its OWN throwaway booking (via the real
 * `POST /api/bookings`, `bookedBy` always resolving server-side to the
 * fixed "current person" — so `canCancel` is always `true` for a
 * booking this suite itself created) and cleans it up in `afterEach`,
 * rather than touching any of the 5 originally-seeded rows.
 */

const API_BASE_URL = 'http://localhost:3001';

let bookingIdsToCleanUp: string[] = [];

test.afterEach(async ({ request }) => {
  for (const id of bookingIdsToCleanUp) {
    await deleteLiveBooking(request, id);
  }
  bookingIdsToCleanUp = [];
});

/**
 * Creates a throwaway booking far enough in the future, and randomised
 * widely enough, that parallel workers (and other spec files' own
 * far-future fixtures) essentially never land on an overlapping slot on
 * the same resource and spuriously clash with each other — the same
 * strategy `booking-wiring.spec.ts` (issue #39) already uses, anchored
 * further out (~650 days) to keep this file's own fixtures out of that
 * file's range too.
 */
async function createThrowawayBooking(request: import('@playwright/test').APIRequestContext) {
  const resources = await fetchLiveResources(request);
  const people = await fetchLivePeople(request);
  const purposes = await fetchLivePurposes(request);
  test.skip(
    resources.length === 0 || people.length === 0 || purposes.length === 0,
    'requires seeded resources, people and purposes',
  );

  const randomHourOffset = Math.floor(Math.random() * 24 * 400);
  const startInstant = new Date(Date.now() + 1000 * 60 * 60 * (24 * 650 + randomHourOffset));
  startInstant.setUTCMinutes(0, 0, 0);
  const endInstant = new Date(startInstant.getTime() + 60 * 60 * 1000);

  // The booking API's `start`/`end` are Europe/Berlin *local wall-clock*
  // strings (`YYYY-MM-DDTHH:mm`, no offset) per `support/api.ts`'s own
  // `createLiveBooking` doc comment — confirmed directly against the
  // live backend while writing this file (an offset-suffixed UTC instant
  // is silently reinterpreted as if its digits were already Berlin local
  // time, which shifts the actual stored instant by the Berlin/UTC
  // offset). Sending genuine Berlin-local strings avoids that mismatch
  // and keeps the fixture's `start`/`end` unambiguous input to the
  // backend, matching `berlinLocalDateTimeInput`'s own doc comment.
  const booking = await createLiveBooking(request, {
    resourceId: resources[0].id,
    bookedForId: people[0].id,
    purposeId: purposes[0].id,
    start: berlinLocalDateTimeInput(startInstant),
    end: berlinLocalDateTimeInput(endInstant),
  });
  bookingIdsToCleanUp.push(booking.id);

  // Ground truth for the ISO instants this specific booking was actually
  // stored as, taken from the backend's own response rather than
  // re-derived — `createLiveBooking`'s return type only carries
  // `id`/`resource`, so fetch the full record once here.
  const getResponse = await request.get(`${API_BASE_URL}/api/bookings/${booking.id}`);
  const body = (await getResponse.json()) as { booking: { start: string; end: string } };

  return {
    booking,
    resourceName: resources[0].name,
    start: body.booking.start,
    end: body.booking.end,
  };
}

/** Tabs forward from whatever currently has focus until `locator` is
 * focused, or `guard` Tabs have been pressed — mirrors the keyboard-
 * reachability pattern already used in `booking-wiring.spec.ts`/
 * `booking-detail.spec.ts`. */
async function tabUntilFocused(
  page: import('@playwright/test').Page,
  locator: import('@playwright/test').Locator,
  guard = 25,
) {
  let remaining = guard;
  while (!(await locator.evaluate((el) => el === document.activeElement)) && remaining > 0) {
    await page.keyboard.press('Tab');
    remaining -= 1;
  }
}

test.describe('cancel booking confirmation dialog — issue #43', () => {
  test('AC: opening the confirmation moves focus into the dialog, which names the specific booking by resource and time range', async ({
    page,
    request,
  }) => {
    const { booking, resourceName, start, end } = await createThrowawayBooking(request);
    await page.goto(`/bookings/${booking.id}`);

    const expectedRange = `${formatBerlinDateTime(start)} – ${formatBerlinDateTime(end)}`;
    // Ground truth: the underlying `<dl>` this dialog must agree with.
    await expect(
      page.getByRole('definition').filter({ hasText: expectedRange }),
    ).toBeVisible();

    const trigger = page.getByRole('button', { name: 'Cancel booking' });
    await trigger.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: `Cancel booking: ${resourceName}` });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Cancel this booking?' })).toBeVisible();
    await expect(dialog).toContainText(`${resourceName}, ${expectedRange}`);

    // Focus has moved off the page's other content and into the dialog
    // subtree (the dialog container itself, or one of its own
    // focusables) — never left dangling on the trigger or elsewhere.
    const focusIsInsideDialog = await dialog.evaluate(
      (el) => el === document.activeElement || el.contains(document.activeElement),
    );
    expect(focusIsInsideDialog).toBe(true);
  });

  test('AC: focus is trapped inside the dialog — repeated Tabs only ever cycle its own two buttons, never the page nav or heading', async ({
    page,
    request,
  }) => {
    const { booking } = await createThrowawayBooking(request);
    await page.goto(`/bookings/${booking.id}`);

    await page.getByRole('button', { name: 'Cancel booking' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const confirmButton = dialog.getByRole('button', { name: 'Yes, cancel it' });
    const keepButton = dialog.getByRole('button', { name: 'No, keep it' });

    // Cycle well past the two focusable elements the dialog contains,
    // asserting on every hop that focus never escapes to the page's own
    // nav links or heading.
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab');
      const focusedIsExpected = await page.evaluate(() => {
        const active = document.activeElement;
        return active !== null && (active.textContent === 'Yes, cancel it' || active.textContent === 'No, keep it');
      });
      expect(focusedIsExpected).toBe(true);
    }
    await expect(page.getByRole('link', { name: 'Resources' })).not.toBeFocused();
    await expect(page.getByRole('heading', { level: 1 })).not.toBeFocused();
    // Sanity: both buttons were actually visited during the cycle above.
    await confirmButton.focus();
    await expect(confirmButton).toBeFocused();
    await keepButton.focus();
    await expect(keepButton).toBeFocused();
  });

  test('AC-10: pressing Escape backs out, firing no DELETE, leaving the booking unchanged, and restores focus to the trigger', async ({
    page,
    request,
  }) => {
    const { booking } = await createThrowawayBooking(request);
    const deleteRequests: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'DELETE' && req.url().includes('/api/bookings/')) {
        deleteRequests.push(req.url());
      }
    });

    await page.goto(`/bookings/${booking.id}`);
    const trigger = page.getByRole('button', { name: 'Cancel booking' });
    await trigger.click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(deleteRequests).toEqual([]);
    await expect(trigger).toBeFocused();

    // Leaves the booking unchanged server-side too, not just
    // client-side: reload and confirm it is still there.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Booking detail' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel booking' })).toBeVisible();
    const getResponse = await request.get(`${API_BASE_URL}/api/bookings/${booking.id}`);
    expect(getResponse.status()).toBe(200);
  });

  test('AC-10: choosing "No, keep it" backs out the same as Escape — no DELETE, booking unchanged, focus restored', async ({
    page,
    request,
  }) => {
    const { booking } = await createThrowawayBooking(request);
    const deleteRequests: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'DELETE' && req.url().includes('/api/bookings/')) {
        deleteRequests.push(req.url());
      }
    });

    await page.goto(`/bookings/${booking.id}`);
    const trigger = page.getByRole('button', { name: 'Cancel booking' });
    await trigger.click();

    await page.getByRole('button', { name: 'No, keep it' }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(deleteRequests).toEqual([]);
    await expect(trigger).toBeFocused();

    const getResponse = await request.get(`${API_BASE_URL}/api/bookings/${booking.id}`);
    expect(getResponse.status()).toBe(200);
  });

  test('AC-10: clicking outside the dialog (the underlay) backs out — no DELETE, booking unchanged', async ({
    page,
    request,
  }) => {
    const { booking } = await createThrowawayBooking(request);
    const deleteRequests: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'DELETE' && req.url().includes('/api/bookings/')) {
        deleteRequests.push(req.url());
      }
    });

    await page.goto(`/bookings/${booking.id}`);
    await page.getByRole('button', { name: 'Cancel booking' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // A corner of the viewport, well outside the centred dialog panel.
    await page.mouse.click(2, 2);

    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(deleteRequests).toEqual([]);

    const getResponse = await request.get(`${API_BASE_URL}/api/bookings/${booking.id}`);
    expect(getResponse.status()).toBe(200);
  });

  test('AC-8/Flow B: confirming via keyboard alone fires exactly one DELETE, announces success as role="status" text, and the booking is genuinely gone', async ({
    page,
    request,
  }) => {
    const { booking } = await createThrowawayBooking(request);
    const deleteRequests: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'DELETE' && req.url().includes('/api/bookings/')) {
        deleteRequests.push(req.url());
      }
    });

    await page.goto(`/bookings/${booking.id}`);
    const trigger = page.getByRole('button', { name: 'Cancel booking' });
    await trigger.focus();
    await page.keyboard.press('Enter');

    const confirmButton = page.getByRole('button', { name: 'Yes, cancel it' });
    await tabUntilFocused(page, confirmButton);
    await expect(confirmButton).toBeFocused();
    await page.keyboard.press('Enter');

    const status = page.getByRole('status');
    await expect(status).toBeVisible();
    await expect(status).toHaveText('This booking has been cancelled.');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);

    expect(deleteRequests).toEqual([`${API_BASE_URL}/api/bookings/${booking.id}`]);

    const getResponse = await request.get(`${API_BASE_URL}/api/bookings/${booking.id}`);
    expect(getResponse.status()).toBe(404);
  });

  test('AC: confirming twice in quick succession (double activation) never produces an alarming duplicate-error state — the resulting DELETE(s) settle as exactly one graceful cancellation', async ({
    page,
    request,
  }) => {
    const { booking } = await createThrowawayBooking(request);
    const deleteResponseStatuses: number[] = [];
    page.on('response', (res) => {
      if (res.request().method() === 'DELETE' && res.url().includes('/api/bookings/')) {
        deleteResponseStatuses.push(res.status());
      }
    });

    await page.goto(`/bookings/${booking.id}`);
    await page.getByRole('button', { name: 'Cancel booking' }).click();
    const confirmButton = page.getByRole('button', { name: 'Yes, cancel it' });

    // Widen the race window with a deliberately slow DELETE response, so
    // a real double-click that fires before the first response comes
    // back is exercised, not merely a double-click too slow to matter.
    await page.route(`**/api/bookings/${booking.id}`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue();
    });

    // Two `click()` calls dispatched synchronously in the same task, on
    // purpose — the tightest possible "confirm twice" a real fast
    // double-click could produce. Verified while writing this test (by
    // temporarily removing the component's own
    // `isDisabled={mutation.isPending}` guard, and separately its
    // "404 is treated as the same success outcome" `onError` handling)
    // that this exact repro DOES surface a regression in either
    // safeguard: two real DELETE requests reach the backend (the
    // `isDisabled` guard reacts to React state that hasn't re-rendered
    // yet inside this single synchronous burst — a `Promise.all` of two
    // separate `keyboard.press('Enter')` calls is NOT tight enough to
    // reproduce this, since each round-trips through its own CDP
    // dispatch and settles before the second fires). The AC this proves
    // is NOT "only one network call is ever made" — a genuine race at
    // this speed can and does produce two — it is "the outcome the user
    // sees is exactly one graceful cancellation, never a duplicate
    // destructive effect or an alarming error".
    await confirmButton.evaluate((el) => {
      (el as HTMLButtonElement).click();
      (el as HTMLButtonElement).click();
    });

    const status = page.getByRole('status');
    await expect(status).toHaveText('This booking has been cancelled.', { timeout: 10_000 });
    // Exactly one success announcement is ever shown — not two, and
    // never alongside an alert.
    await expect(status).toHaveCount(1);
    await expect(page.getByRole('alert')).toHaveCount(0);

    // Whichever of the (at most two) DELETE requests the backend
    // actually received, only ONE of them can have performed the real
    // destructive delete (`204`) — any other is necessarily a `404`
    // against the now-already-gone booking (the exclusion-constraint-
    // backed hard delete makes a second real delete of the same row
    // impossible), never a second success and never an unexpected
    // status.
    const successCount = deleteResponseStatuses.filter((status) => status === 204).length;
    expect(successCount).toBe(1);
    for (const responseStatus of deleteResponseStatuses) {
      expect([204, 404]).toContain(responseStatus);
    }

    await page.unroute(`**/api/bookings/${booking.id}`);
    const getResponse = await request.get(`${API_BASE_URL}/api/bookings/${booking.id}`);
    expect(getResponse.status()).toBe(404);
  });

  test('AC: confirming a booking that a genuine race already removed (a raw second DELETE lands first) is treated as the same cancelled outcome, not an alarming error', async ({
    page,
    request,
  }) => {
    const { booking } = await createThrowawayBooking(request);

    await page.goto(`/bookings/${booking.id}`);
    await page.getByRole('button', { name: 'Cancel booking' }).click();
    const confirmButton = page.getByRole('button', { name: 'Yes, cancel it' });

    // Fire the UI's confirm click and a raw, out-of-band DELETE (as if
    // another tab/person/process removed the same booking) at the same
    // time. Whichever DELETE the backend processes first succeeds
    // (204); the other necessarily 404s, since the row is genuinely
    // gone by then. From the user's point of view both outcomes are
    // identical — "this booking is cancelled" — never a duplicate
    // destructive call or a scary error.
    const uiConfirm = confirmButton.click();
    const rawDelete = request.delete(`${API_BASE_URL}/api/bookings/${booking.id}`);
    await Promise.all([uiConfirm, rawDelete]);

    const status = page.getByRole('status');
    await expect(status).toHaveText('This booking has been cancelled.');
    await expect(page.getByRole('alert')).toHaveCount(0);

    const getResponse = await request.get(`${API_BASE_URL}/api/bookings/${booking.id}`);
    expect(getResponse.status()).toBe(404);
  });

  test('AC: a genuine unexpected failure keeps the dialog open, announces role="alert", re-enables the confirm button, and leaves the booking untouched', async ({
    page,
    request,
  }) => {
    const { booking } = await createThrowawayBooking(request);

    await page.goto(`/bookings/${booking.id}`);
    await page.getByRole('button', { name: 'Cancel booking' }).click();

    await page.route(`**/api/bookings/${booking.id}`, async (route) => {
      if (route.request().method() !== 'DELETE') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'internal_error', message: 'boom' } }),
      });
    });

    const confirmButton = page.getByRole('button', { name: 'Yes, cancel it' });
    await confirmButton.click();

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(
      'This booking could not be cancelled. It is still active. Please try again.',
    );
    // Dialog stays open — this is a refusal to act, not a cancellation.
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
    await expect(confirmButton).toBeEnabled();

    await page.unroute(`**/api/bookings/${booking.id}`);

    // The booking is genuinely untouched server-side.
    const getResponse = await request.get(`${API_BASE_URL}/api/bookings/${booking.id}`);
    expect(getResponse.status()).toBe(200);

    // Backing out afterwards still works normally (dialog isn't stuck).
    await page.getByRole('button', { name: 'No, keep it' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('AC: the open confirmation dialog has no automatically detectable accessibility violations', async ({
    page,
    request,
  }) => {
    const { booking } = await createThrowawayBooking(request);
    await page.goto(`/bookings/${booking.id}`);
    await page.getByRole('button', { name: 'Cancel booking' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
