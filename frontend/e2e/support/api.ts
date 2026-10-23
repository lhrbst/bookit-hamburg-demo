import type { APIRequestContext } from '@playwright/test';

/**
 * Live-backend helpers shared across specs.
 *
 * These call the *real* backend directly (not through the SPA) purely to
 * discover ground truth for assertions (e.g. "what resources actually
 * exist right now") — never to fake state the UI itself must produce.
 * Keeps tests robust to seed-data changes instead of hardcoding resource
 * names, per the issue's own instruction.
 */
const API_BASE_URL = 'http://localhost:3001';

export interface LiveResource {
  id: string;
  name: string;
  type: 'room' | 'equipment';
  description: string;
}

export async function fetchLiveResources(request: APIRequestContext): Promise<LiveResource[]> {
  const response = await request.get(`${API_BASE_URL}/api/resources`);
  if (!response.ok()) {
    throw new Error(`GET /api/resources failed with status ${response.status()}`);
  }
  return response.json();
}

export async function fetchLiveSchedule(
  request: APIRequestContext,
  resourceId: string,
): Promise<{ segments: unknown[] }> {
  const response = await request.get(`${API_BASE_URL}/api/resources/${resourceId}/schedule`);
  if (!response.ok()) {
    throw new Error(
      `GET /api/resources/${resourceId}/schedule failed with status ${response.status()}`,
    );
  }
  return response.json();
}

export interface LiveScheduleSegment {
  type: 'booked' | 'free';
  id?: string;
  start: string;
  end: string;
  bookedBy?: { id: string; name: string };
  bookedFor?: { id: string; name: string };
  continuesFromPreviousDay?: boolean;
  continuesIntoNextDay?: boolean;
}

export interface LiveResourceSchedule {
  resource: LiveResource;
  segments: LiveScheduleSegment[];
}

/** Fetches a resource's schedule for a specific `date` (`YYYY-MM-DD`,
 * Europe/Berlin) — ground truth for the segment-rendering assertions in
 * `resource-schedule.spec.ts` (issue #26). */
export async function fetchLiveScheduleForDate(
  request: APIRequestContext,
  resourceId: string,
  date: string,
): Promise<LiveResourceSchedule> {
  const response = await request.get(
    `${API_BASE_URL}/api/resources/${resourceId}/schedule?date=${date}`,
  );
  if (!response.ok()) {
    throw new Error(
      `GET /api/resources/${resourceId}/schedule?date=${date} failed with status ${response.status()}`,
    );
  }
  return response.json();
}

/** Optional "booked by"/"booked for" narrowing filters for
 * {@link fetchLiveFilteredSchedule} (FS-01 FR-3/§6.4, issue #27). */
export interface LiveScheduleFilters {
  bookedById?: string;
  bookedForId?: string;
}

/** Fetches a resource's schedule for a specific `date`, optionally
 * narrowed by "booked by"/"booked for" person ids — ground truth for the
 * filter-narrowing assertions in `resource-schedule-filters.spec.ts`
 * (issue #27). Deriving the expected filtered outcome from this live
 * endpoint (rather than assuming a fixed fixture shape) keeps the spec
 * correct even if the shared dev database carries bookings beyond the
 * migration's own seed rows. */
export async function fetchLiveFilteredSchedule(
  request: APIRequestContext,
  resourceId: string,
  date: string,
  filters: LiveScheduleFilters = {},
): Promise<LiveResourceSchedule> {
  const search = new URLSearchParams({ date });
  if (filters.bookedById !== undefined) {
    search.set('bookedById', filters.bookedById);
  }
  if (filters.bookedForId !== undefined) {
    search.set('bookedForId', filters.bookedForId);
  }
  const response = await request.get(
    `${API_BASE_URL}/api/resources/${resourceId}/schedule?${search.toString()}`,
  );
  if (!response.ok()) {
    throw new Error(
      `GET /api/resources/${resourceId}/schedule?${search.toString()} failed with status ${response.status()}`,
    );
  }
  return response.json();
}

/** Creates a booking directly against the real backend as test fixture
 * setup — never through the UI. `start`/`end` are Europe/Berlin local
 * wall-clock strings (`YYYY-MM-DDTHH:mm`), matching the API's contract
 * (no offset/zone is ever accepted — FS-02 FR-4). Callers MUST clean up
 * with {@link deleteLiveBooking} so the shared database returns to its
 * known seed state. */
export async function createLiveBooking(
  request: APIRequestContext,
  input: { resourceId: string; bookedForId: string; purposeId: string; start: string; end: string },
): Promise<{ id: string; resource: { id: string; name: string } }> {
  const response = await request.post(`${API_BASE_URL}/api/bookings`, { data: input });
  if (!response.ok()) {
    throw new Error(
      `POST /api/bookings failed with status ${response.status()}: ${await response.text()}`,
    );
  }
  const body = await response.json();
  return body.booking;
}

/** Deletes a booking created via {@link createLiveBooking} (or any other
 * fixture helper), so a test never leaves data behind in the shared
 * Postgres database. Safe to call even if the booking is already gone
 * (404s are swallowed) so cleanup itself never fails a test. */
export async function deleteLiveBooking(
  request: APIRequestContext,
  bookingId: string,
): Promise<void> {
  const response = await request.delete(`${API_BASE_URL}/api/bookings/${bookingId}`);
  if (!response.ok() && response.status() !== 404) {
    throw new Error(`DELETE /api/bookings/${bookingId} failed with status ${response.status()}`);
  }
}

/** One entry of the today-overview / cross-resource booking list
 * (`GET /api/bookings`) — mirrors `frontend/src/lib/types.ts`'s
 * `BookingOverviewItem`, reimplemented here rather than imported so a bug
 * in the app's own type does not silently make this test agree with
 * itself. */
export interface LiveBookingOverviewItem {
  id: string;
  resource: { id: string; name: string };
  start: string;
  end: string;
  bookedBy: { id: string; name: string };
  bookedFor: { id: string; name: string };
  continuesFromPreviousDay: boolean;
  continuesIntoNextDay: boolean;
}

/** Fetches the cross-resource booking list for a given day (`GET
 * /api/bookings?date=...`), or "today" (server-side, Europe/Berlin) when
 * `date` is omitted — ground truth for the today-overview assertions in
 * `today-overview.spec.ts` (issue #28). */
export async function fetchLiveTodayBookings(
  request: APIRequestContext,
  date?: string,
): Promise<LiveBookingOverviewItem[]> {
  const query = date !== undefined ? `?date=${date}` : '';
  const response = await request.get(`${API_BASE_URL}/api/bookings${query}`);
  if (!response.ok()) {
    throw new Error(`GET /api/bookings${query} failed with status ${response.status()}`);
  }
  return response.json();
}

/** Optional resource/"booked by"/"booked for" narrowing filters for
 * {@link fetchLiveFilteredTodayBookings} (FS-01 FR-3/§6.4, issue #29). */
export interface LiveTodayOverviewFilters {
  resourceId?: string;
  bookedById?: string;
  bookedForId?: string;
}

/** Fetches the cross-resource booking list for a given day (defaults to
 * "today", server-side, Europe/Berlin, when `date` is omitted), narrowed
 * additively by resource/"booked by"/"booked for" — ground truth for the
 * filter-narrowing assertions in `today-overview-filters.spec.ts` (issue
 * #29). Mirrors `fetchLiveFilteredSchedule`'s "trust the live API, not an
 * assumed fixture shape" approach. */
export async function fetchLiveFilteredTodayBookings(
  request: APIRequestContext,
  filters: LiveTodayOverviewFilters = {},
  date?: string,
): Promise<LiveBookingOverviewItem[]> {
  const search = new URLSearchParams();
  if (date !== undefined) {
    search.set('date', date);
  }
  if (filters.resourceId !== undefined) {
    search.set('resourceId', filters.resourceId);
  }
  if (filters.bookedById !== undefined) {
    search.set('bookedById', filters.bookedById);
  }
  if (filters.bookedForId !== undefined) {
    search.set('bookedForId', filters.bookedForId);
  }
  const query = search.toString();
  const response = await request.get(`${API_BASE_URL}/api/bookings${query === '' ? '' : `?${query}`}`);
  if (!response.ok()) {
    throw new Error(`GET /api/bookings?${query} failed with status ${response.status()}`);
  }
  return response.json();
}

/** A syntactically valid UUID that (bar astronomical bad luck) never identifies a real resource. */
export const NON_EXISTENT_RESOURCE_ID = '00000000-0000-0000-0000-000000000000';

export interface LivePerson {
  id: string;
  name: string;
}

/** Fetches the three seeded people (`GET /api/people`) — ground truth for
 * the "Booked for" select's options in `booking-form.spec.ts` (issue
 * #40). */
export async function fetchLivePeople(request: APIRequestContext): Promise<LivePerson[]> {
  const response = await request.get(`${API_BASE_URL}/api/people`);
  if (!response.ok()) {
    throw new Error(`GET /api/people failed with status ${response.status()}`);
  }
  return response.json();
}

/** Fetches the current person (`GET /api/me`, always "Alex Nguyen" — no
 * auth in this app) — ground truth for the booking-creator display line
 * in `booking-form.spec.ts` (issue #40). */
export async function fetchLiveMe(request: APIRequestContext): Promise<LivePerson> {
  const response = await request.get(`${API_BASE_URL}/api/me`);
  if (!response.ok()) {
    throw new Error(`GET /api/me failed with status ${response.status()}`);
  }
  return response.json();
}

export interface LivePurpose {
  id: string;
  label: string;
}

/** Fetches the fixed purpose category set (`GET /api/purposes`) — ground
 * truth for the "Purpose" select's options in `booking-form.spec.ts`
 * (issue #40). */
export async function fetchLivePurposes(request: APIRequestContext): Promise<LivePurpose[]> {
  const response = await request.get(`${API_BASE_URL}/api/purposes`);
  if (!response.ok()) {
    throw new Error(`GET /api/purposes failed with status ${response.status()}`);
  }
  const body = await response.json();
  return body.purposes;
}
