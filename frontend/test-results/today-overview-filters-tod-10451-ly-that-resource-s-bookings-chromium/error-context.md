# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: today-overview-filters.spec.ts >> today overview filters (issue #29) >> AC-5: filtering by one resource leaves only that resource's bookings
- Location: e2e/today-overview-filters.spec.ts:188:3

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

Expected: ArrayContaining ["1f383b04-b50a-4552-b9c3-f6b81ba86b22", "aa8622ca-8f38-4926-a4ce-8d4cba6edac9"]
Received: []
```

# Test source

```ts
  111 |   return page.getByRole('list', { name: `All bookings today, ${todayInBerlin()}` });
  112 | }
  113 | 
  114 | /** The "Resource" filter's trigger button — see the locator note above. */
  115 | function resourceSelect(page: Page) {
  116 |   return page.getByRole('button', { name: /Resource/ });
  117 | }
  118 | 
  119 | /** The "Booked by" filter's trigger button — see the locator note above. */
  120 | function bookedBySelect(page: Page) {
  121 |   return page.getByRole('button', { name: /Booked by/ });
  122 | }
  123 | 
  124 | /** The "Booked for" filter's trigger button — see the locator note above. */
  125 | function bookedForSelect(page: Page) {
  126 |   return page.getByRole('button', { name: /Booked for/ });
  127 | }
  128 | 
  129 | async function chooseOption(
  130 |   select: ReturnType<typeof resourceSelect>,
  131 |   page: Page,
  132 |   optionName: string,
  133 | ) {
  134 |   await select.click();
  135 |   await page.getByRole('option', { name: optionName, exact: true }).click();
  136 | }
  137 | 
  138 | /** Asserts the rendered `<ul>` matches the live, filtered `GET
  139 |  * /api/bookings` response exactly (in order) for this filter
  140 |  * combination — never a re-derived/assumed shape, mirroring
  141 |  * `resource-schedule-filters.spec.ts`'s
  142 |  * `expectListMatchesLiveFilteredSchedule`. */
  143 | async function expectListMatchesLiveFilteredToday(
  144 |   page: Page,
  145 |   request: Parameters<typeof fetchLiveFilteredTodayBookings>[0],
  146 |   filters: { resourceId?: string; bookedById?: string; bookedForId?: string },
  147 | ) {
  148 |   const liveBookings = await fetchLiveFilteredTodayBookings(request, filters);
  149 |   const list = todayList(page);
  150 |   if (liveBookings.length === 0) {
  151 |     await expect(list).toHaveCount(0);
  152 |     return liveBookings;
  153 |   }
  154 |   await expect(list).toBeVisible();
  155 |   const items = list.getByRole('listitem');
  156 |   await expect(items).toHaveCount(liveBookings.length);
  157 |   for (const [index, booking] of liveBookings.entries()) {
  158 |     await expect(items.nth(index)).toHaveText(expectedEntryText(booking));
  159 |   }
  160 |   return liveBookings;
  161 | }
  162 | 
  163 | test.describe.configure({ mode: 'serial' });
  164 | 
  165 | test.describe('today overview filters (issue #29)', () => {
  166 |   test('unfiltered baseline: the resource filter offers "All resources" plus every seeded resource, and no filter is active', async ({
  167 |     page,
  168 |   }) => {
  169 |     await page.goto('/today');
  170 | 
  171 |     await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  172 |     await expect(resourceSelect(page)).toContainText('All resources');
  173 |     await expect(bookedBySelect(page)).toContainText('Anyone');
  174 |     await expect(bookedForSelect(page)).toContainText('Anyone');
  175 | 
  176 |     await expect(
  177 |       page.getByText('Showing all bookings today (no filters applied).'),
  178 |     ).toBeVisible();
  179 |     await expect(page.getByRole('button', { name: 'Clear filters' })).toBeDisabled();
  180 | 
  181 |     await resourceSelect(page).click();
  182 |     await expect(page.getByRole('option', { name: 'All resources', exact: true })).toBeVisible();
  183 |     await expect(page.getByRole('option', { name: NEBEL_NAME, exact: true })).toBeVisible();
  184 |     await expect(page.getByRole('option', { name: ELBE_NAME, exact: true })).toBeVisible();
  185 |     await page.keyboard.press('Escape');
  186 |   });
  187 | 
  188 |   test('AC-5: filtering by one resource leaves only that resource\'s bookings', async ({
  189 |     page,
  190 |     request,
  191 |   }) => {
  192 |     await withTodayLock(async () => {
  193 |       const randomAnchor = 20 + Math.floor(Math.random() * 600);
  194 |       const nebelBooking = await createLiveBooking(request, {
  195 |         resourceId: NEBEL_ID,
  196 |         bookedForId: ALEX_ID,
  197 |         purposeId: 'Meeting',
  198 |         start: futureBerlinLocal(randomAnchor).local,
  199 |         end: futureBerlinLocal(randomAnchor + 20).local,
  200 |       });
  201 |       const elbeBooking = await createLiveBooking(request, {
  202 |         resourceId: ELBE_ID,
  203 |         bookedForId: BRIGITTE_ID,
  204 |         purposeId: 'Focus work',
  205 |         start: futureBerlinLocal(randomAnchor + 60).local,
  206 |         end: futureBerlinLocal(randomAnchor + 80).local,
  207 |       });
  208 | 
  209 |       try {
  210 |         const liveBookings = await fetchLiveTodayBookings(request);
> 211 |         expect(liveBookings.map((b) => b.id)).toEqual(
      |                                               ^ Error: expect(received).toEqual(expected) // deep equality
  212 |           expect.arrayContaining([nebelBooking.id, elbeBooking.id]),
  213 |         );
  214 | 
  215 |         await page.goto('/today');
  216 |         await expect(todayList(page).getByRole('listitem').first()).toBeVisible();
  217 | 
  218 |         await chooseOption(resourceSelect(page), page, NEBEL_NAME);
  219 | 
  220 |         const filtered = await expectListMatchesLiveFilteredToday(page, request, {
  221 |           resourceId: NEBEL_ID,
  222 |         });
  223 |         expect(filtered.length).toBeGreaterThan(0);
  224 |         expect(filtered.every((b) => b.resource.id === NEBEL_ID)).toBe(true);
  225 |         expect(filtered.some((b) => b.id === elbeBooking.id)).toBe(false);
  226 |         expect(filtered.some((b) => b.id === nebelBooking.id)).toBe(true);
  227 | 
  228 |         await expect(page.getByText(`Showing bookings for ${NEBEL_NAME}.`)).toBeVisible();
  229 |         await expect(page.getByRole('button', { name: 'Clear filters' })).toBeEnabled();
  230 |       } finally {
  231 |         await deleteLiveBooking(request, nebelBooking.id);
  232 |         await deleteLiveBooking(request, elbeBooking.id);
  233 |       }
  234 |     });
  235 |   });
  236 | 
  237 |   test('the resource control cannot select more than one resource: choosing a second resource replaces, never adds to, the first', async ({
  238 |     page,
  239 |     request,
  240 |   }) => {
  241 |     await withTodayLock(async () => {
  242 |       await page.goto('/today');
  243 |       await expect(resourceSelect(page)).toBeVisible();
  244 | 
  245 |       await chooseOption(resourceSelect(page), page, NEBEL_NAME);
  246 |       await expect(resourceSelect(page)).toContainText(NEBEL_NAME);
  247 |       await expect(page.getByText(`Showing bookings for ${NEBEL_NAME}.`)).toBeVisible();
  248 | 
  249 |       await chooseOption(resourceSelect(page), page, ELBE_NAME);
  250 |       await expect(resourceSelect(page)).toContainText(ELBE_NAME);
  251 |       await expect(resourceSelect(page)).not.toContainText(NEBEL_NAME);
  252 |       await expect(page.getByText(`Showing bookings for ${ELBE_NAME}.`)).toBeVisible();
  253 |       await expect(page.getByText(`Showing bookings for ${NEBEL_NAME}.`)).toHaveCount(0);
  254 | 
  255 |       // The underlying widget itself only ever exposes a single trigger
  256 |       // button naming the (one) current selection, not a multi-value
  257 |       // widget — confirming there is exactly one resource selection
  258 |       // surfaced to assistive technology at any time.
  259 |       await expect(page.getByRole('button', { name: /Resource/ })).toHaveCount(1);
  260 | 
  261 |       await expectListMatchesLiveFilteredToday(page, request, { resourceId: ELBE_ID });
  262 |     });
  263 |   });
  264 | 
  265 |   test('AC-7: resource and "booked for" filters combine additively', async ({ page, request }) => {
  266 |     await withTodayLock(async () => {
  267 |       // NOTE: `createLiveBooking` always attributes the booking to whatever
  268 |       // person the backend's `GET /api/me` currently reports as "current
  269 |       // person" (Alex Nguyen in this environment) — `bookedForId` is the
  270 |       // only per-booking party this fixture helper can vary. This test
  271 |       // therefore proves the additive AC-7 combination using
  272 |       // resource + "booked for" (both freely controllable), rather than
  273 |       // "booked by" (which every fixture booking shares regardless of
  274 |       // input) — a genuine constraint of the live API, not a shortcut.
  275 |       const randomAnchor = 20 + Math.floor(Math.random() * 600);
  276 |       const nebelForAlex = await createLiveBooking(request, {
  277 |         resourceId: NEBEL_ID,
  278 |         bookedForId: ALEX_ID,
  279 |         purposeId: 'Meeting',
  280 |         start: futureBerlinLocal(randomAnchor).local,
  281 |         end: futureBerlinLocal(randomAnchor + 20).local,
  282 |       });
  283 |       const nebelForBrigitte = await createLiveBooking(request, {
  284 |         resourceId: NEBEL_ID,
  285 |         bookedForId: BRIGITTE_ID,
  286 |         purposeId: 'Focus work',
  287 |         start: futureBerlinLocal(randomAnchor + 60).local,
  288 |         end: futureBerlinLocal(randomAnchor + 80).local,
  289 |       });
  290 | 
  291 |       try {
  292 |         await page.goto('/today');
  293 |         await expect(todayList(page).getByRole('listitem').first()).toBeVisible();
  294 | 
  295 |         await chooseOption(resourceSelect(page), page, NEBEL_NAME);
  296 |         await chooseOption(bookedForSelect(page), page, ALEX_NAME);
  297 | 
  298 |         const filtered = await expectListMatchesLiveFilteredToday(page, request, {
  299 |           resourceId: NEBEL_ID,
  300 |           bookedForId: ALEX_ID,
  301 |         });
  302 |         expect(filtered.length).toBeGreaterThan(0);
  303 |         expect(
  304 |           filtered.every((b) => b.resource.id === NEBEL_ID && b.bookedFor.id === ALEX_ID),
  305 |         ).toBe(true);
  306 |         expect(filtered.some((b) => b.id === nebelForBrigitte.id)).toBe(false);
  307 |         expect(filtered.some((b) => b.id === nebelForAlex.id)).toBe(true);
  308 | 
  309 |         const summary = page.getByText(/Showing bookings/);
  310 |         await expect(summary).toHaveText(
  311 |           `Showing bookings for ${NEBEL_NAME} booked for ${ALEX_NAME}.`,
```