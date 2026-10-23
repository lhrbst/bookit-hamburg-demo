# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: booking-navigation.spec.ts >> create/cancel round trips refetch FS-01 views from the server (issue #44) >> AC-9: returning to a resource schedule after cancelling a booking (via the persistent nav, SPA navigation only) shows the period free again, refetched from the server
- Location: e2e/booking-navigation.spec.ts:473:3

# Error details

```
Error: expect(received).toBeDefined()

Received: undefined
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - navigation "Main" [ref=e5]:
      - generic [ref=e6]: Bookit
      - list [ref=e7]:
        - listitem [ref=e8]:
          - link "Resources" [ref=e9] [cursor=pointer]:
            - /url: /resources
        - listitem [ref=e10]:
          - link "Today's bookings" [ref=e11] [cursor=pointer]:
            - /url: /today
  - main [ref=e12]:
    - region [ref=e13]:
      - heading "Today's bookings — 2026-10-08" [level=1] [ref=e14]
      - group "Filter today's bookings" [ref=e15]:
        - generic [ref=e16]: Filters
        - generic [ref=e17]:
          - generic [ref=e18]:
            - generic [ref=e19]: Resource
            - button "All resources Resource" [ref=e20]:
              - generic [ref=e21]: All resources
            - combobox [ref=e26]
          - generic [ref=e27]:
            - generic [ref=e28]: Booked by
            - button "Anyone Booked by" [ref=e29]:
              - generic [ref=e30]: Anyone
            - combobox [ref=e35]
          - generic [ref=e36]:
            - generic [ref=e37]: Booked for
            - button "Anyone Booked for" [ref=e38]:
              - generic [ref=e39]: Anyone
            - combobox [ref=e44]
          - button "Clear filters" [disabled]
        - status [ref=e45]: Showing all bookings today (no filters applied).
      - status [ref=e46]: Nothing is booked today.
```

# Test source

```ts
  406 |     try {
  407 |       await page.goto(`/resources/${NEBEL_ID}/schedule/${date}`);
  408 |       await freeSlotLink(page, wholeDayTimeRange).click();
  409 | 
  410 |       await expect(page).toHaveURL(`/resources/${NEBEL_ID}/book`);
  411 | 
  412 |       // Adjust the pre-filled (whole-day) range down to a clean one-hour
  413 |       // slot before submitting — proving editability again in passing,
  414 |       // and giving this test an unambiguous booked/free split to assert
  415 |       // on the way back.
  416 |       await page.getByLabel('Start').fill(`${date}T10:00`);
  417 |       await page.getByLabel('End').fill(`${date}T11:00`);
  418 |       await chooseByKeyboard(page, bookedForButton(page), 'Alex Nguyen');
  419 |       await chooseByKeyboard(page, purposeButton(page), 'Meeting');
  420 | 
  421 |       const [createResponse] = await Promise.all([
  422 |         page.waitForResponse(
  423 |           (res) => res.url().endsWith('/api/bookings') && res.request().method() === 'POST',
  424 |         ),
  425 |         page.getByRole('button', { name: 'Book this resource' }).click(),
  426 |       ]);
  427 |       expect(createResponse.status()).toBe(201);
  428 |       const created = (await createResponse.json()) as { booking: { id: string } };
  429 |       createdBookingId = created.booking.id;
  430 | 
  431 |       await expect(page).toHaveURL(`/bookings/${created.booking.id}/confirmation`);
  432 | 
  433 |       // The real regression assertion: navigating back to the schedule
  434 |       // through the confirmation's OWN in-app link (a React Router
  435 |       // `<Link>`, never `page.reload()`/`page.goto()`) must trigger a
  436 |       // genuine network refetch of the schedule endpoint — proving the
  437 |       // updated segment comes from the server's own recomputation, not
  438 |       // an optimistic local patch of the query cache.
  439 |       const scheduleRefetch = page.waitForResponse(
  440 |         (res) =>
  441 |           res.url().includes(`/api/resources/${NEBEL_ID}/schedule`) && res.request().method() === 'GET',
  442 |       );
  443 |       await page.getByRole('link', { name: `View Nebel’s schedule` }).click();
  444 |       const refetchResponse = await scheduleRefetch;
  445 |       expect(refetchResponse.status()).toBe(200);
  446 |       const refetchedBody = (await refetchResponse.json()) as {
  447 |         segments: LiveScheduleSegment[];
  448 |       };
  449 | 
  450 |       await expect(page).toHaveURL(`/resources/${NEBEL_ID}/schedule/${date}`);
  451 | 
  452 |       const bookedSegment = refetchedBody.segments.find((segment) => segment.type === 'booked');
  453 |       expect(bookedSegment).toBeDefined();
  454 | 
  455 |       const bookedTimeRange = segmentTimeRange(bookedSegment as LiveScheduleSegment);
  456 |       await expect(
  457 |         page.getByText(`Booked ${bookedTimeRange} · Booked by Alex Nguyen for Alex Nguyen.`),
  458 |       ).toBeVisible();
  459 |       // The whole-day "Free ..." entry from before creation must be gone
  460 |       // — replaced by the split free/booked segments the server now
  461 |       // returns.
  462 |       await expect(page.getByText(`Free ${wholeDayTimeRange}.`)).toHaveCount(0);
  463 | 
  464 |       const results = await new AxeBuilder({ page }).include('section').analyze();
  465 |       expect(results.violations).toEqual([]);
  466 |     } finally {
  467 |       if (createdBookingId !== undefined) {
  468 |         await deleteLiveBooking(request, createdBookingId);
  469 |       }
  470 |     }
  471 |   });
  472 | 
  473 |   test('AC-9: returning to a resource schedule after cancelling a booking (via the persistent nav, SPA navigation only) shows the period free again, refetched from the server', async ({
  474 |     page,
  475 |     request,
  476 |   }) => {
  477 |     await withTodayLock(async () => {
  478 |       const randomAnchor = 20 + Math.floor(Math.random() * 600);
  479 |       const { local: start, date: today } = futureBerlinLocal(randomAnchor);
  480 |       const { local: end } = futureBerlinLocal(randomAnchor + 30);
  481 | 
  482 |       const booking = await createLiveBooking(request, {
  483 |         resourceId: PROJECTOR_CART_A_ID,
  484 |         bookedForId: ALEX_ID,
  485 |         purposeId: 'Maintenance',
  486 |         start,
  487 |         end,
  488 |       });
  489 | 
  490 |       try {
  491 |         // Confirm ground truth: the resource's schedule for today
  492 |         // currently shows this booking (server-side), before we touch
  493 |         // anything through the UI.
  494 |         const beforeCancel = await fetchLiveScheduleForDate(request, PROJECTOR_CART_A_ID, today);
  495 |         expect(beforeCancel.segments.some((segment) => segment.type === 'booked')).toBe(true);
  496 | 
  497 |         // Reach the booking's detail page via `/today` — an equally
  498 |         // valid FS-01 entry point (a resource schedule's booked segments
  499 |         // link to their own detail view too, as of issue #55, covered by
  500 |         // its own describe block above; this test's own scope is the
  501 |         // create/cancel refetch round trip, not which FS-01 view was
  502 |         // used to get there).
  503 |         await page.goto('/today');
  504 |         const liveToday = await fetchLiveTodayBookings(request);
  505 |         const entry = liveToday.find((item) => item.id === booking.id);
> 506 |         expect(entry).toBeDefined();
      |                       ^ Error: expect(received).toBeDefined()
  507 |         const timeRange = `${formatBerlinTime(entry!.start)}–${formatBerlinTime(entry!.end)}`;
  508 |         const entryName = `${entry!.resource.name}: ${timeRange} · Booked by ${entry!.bookedBy.name} for ${entry!.bookedFor.name}.`;
  509 |         await page.getByRole('link', { name: entryName, exact: true }).click();
  510 | 
  511 |         await expect(page).toHaveURL(`/bookings/${booking.id}`);
  512 | 
  513 |         await page.getByRole('button', { name: 'Cancel booking' }).click();
  514 |         await expect(page.getByRole('dialog')).toBeVisible();
  515 | 
  516 |         const [cancelResponse] = await Promise.all([
  517 |           page.waitForResponse(
  518 |             (res) =>
  519 |               res.url().endsWith(`/api/bookings/${booking.id}`) && res.request().method() === 'DELETE',
  520 |           ),
  521 |           page.getByRole('button', { name: 'Yes, cancel it' }).click(),
  522 |         ]);
  523 |         expect([200, 204, 404]).toContain(cancelResponse.status());
  524 | 
  525 |         await expect(page.getByRole('status')).toHaveText('This booking has been cancelled.');
  526 | 
  527 |         // Return to the resource's schedule the same way a real user
  528 |         // would, entirely via the app's own persistent SPA navigation
  529 |         // (never `page.reload()`/`page.goto()`): the main nav's
  530 |         // "Resources" link, then that resource's own link (which lands
  531 |         // on today's schedule by default, matching `resource-list.spec.ts`'s
  532 |         // documented behaviour) — never a hard navigation back to the
  533 |         // schedule URL, so this genuinely exercises the mutation's
  534 |         // `invalidateQueries` seam rather than a fresh app boot's normal
  535 |         // fetch-on-mount.
  536 |         const scheduleRefetch = page.waitForResponse(
  537 |           (res) =>
  538 |             res.url().includes(`/api/resources/${PROJECTOR_CART_A_ID}/schedule`) &&
  539 |             res.request().method() === 'GET',
  540 |         );
  541 |         await page.getByRole('link', { name: 'Resources' }).click();
  542 |         await expect(page).toHaveURL('/resources');
  543 |         await page.getByRole('link', { name: 'Projector Cart A' }).click();
  544 | 
  545 |         const refetchResponse = await scheduleRefetch;
  546 |         expect(refetchResponse.status()).toBe(200);
  547 |         const refetchedBody = (await refetchResponse.json()) as { segments: LiveScheduleSegment[] };
  548 | 
  549 |         await expect(page).toHaveURL(`/resources/${PROJECTOR_CART_A_ID}/schedule/${today}`);
  550 | 
  551 |         // The cancelled booking's own time range must now render as free
  552 |         // — matching the server's OWN freshly recomputed segments, not a
  553 |         // client-side patch.
  554 |         expect(refetchedBody.segments.every((segment) => segment.type === 'free')).toBe(true);
  555 |         await expect(page.getByText('This resource is free all day.')).toBeVisible();
  556 |         await expect(page.getByText(entryName, { exact: false })).toHaveCount(0);
  557 | 
  558 |         const results = await new AxeBuilder({ page }).include('section').analyze();
  559 |         expect(results.violations).toEqual([]);
  560 |       } finally {
  561 |         await deleteLiveBooking(request, booking.id);
  562 |       }
  563 |     });
  564 |   });
  565 | });
  566 | 
  567 | /** Converts an ISO instant to the bare Europe/Berlin local `YYYY-MM-
  568 |  * DDTHH:mm` string a native `datetime-local` input's `.value` holds —
  569 |  * independently re-implemented (never imported) from
  570 |  * `frontend/src/lib/dates.ts#toBerlinDateTimeLocalInputValue`, mirroring
  571 |  * this whole suite's convention of never trusting the app's own module
  572 |  * to validate itself. */
  573 | function berlinInstantToLocalInputValue(isoInstant: string): string {
  574 |   const parts = Object.fromEntries(
  575 |     new Intl.DateTimeFormat('en-CA', {
  576 |       timeZone: 'Europe/Berlin',
  577 |       year: 'numeric',
  578 |       month: '2-digit',
  579 |       day: '2-digit',
  580 |       hour: '2-digit',
  581 |       minute: '2-digit',
  582 |       hour12: false,
  583 |     })
  584 |       .formatToParts(new Date(isoInstant))
  585 |       .map((part) => [part.type, part.value]),
  586 |   );
  587 |   return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  588 | }
  589 | 
  590 | function bookedForButton(page: Page) {
  591 |   return page.getByRole('button', { name: /Booked for$/ });
  592 | }
  593 | 
  594 | function purposeButton(page: Page) {
  595 |   return page.getByRole('button', { name: /Purpose$/ });
  596 | }
  597 | 
  598 | /** Opens a `FormSelectField` via keyboard (`Enter`) and chooses
  599 |  * `optionName` from its listbox via keyboard typeahead — mirrors
  600 |  * `booking-form.spec.ts`'s own helper of the same name, duplicated here
  601 |  * (a local support module for both files would be a larger refactor than
  602 |  * this ticket's own scope) rather than driving the select with a mouse
  603 |  * click. */
  604 | async function chooseByKeyboard(page: Page, trigger: ReturnType<typeof bookedForButton>, optionName: string) {
  605 |   await trigger.focus();
  606 |   await page.keyboard.press('Enter');
```