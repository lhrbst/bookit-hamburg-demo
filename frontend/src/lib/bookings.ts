import { apiFetch } from './api';
import type { BookingDetail, BookingOverviewItem } from './types';

/** Optional narrowing filters for {@link listBookings} (FS-01 FR-3/FR-4). */
export interface ListBookingsParams {
  /** `YYYY-MM-DD`, Europe/Berlin calendar day. Omit to default to today (server-side). */
  date?: string;
  resourceId?: string;
  bookedById?: string;
  bookedForId?: string;
}

function buildQuery(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, value);
    }
  }
  const query = search.toString();
  return query === '' ? '' : `?${query}`;
}

/**
 * `GET /api/bookings` — the cross-resource "today overview" query (FS-01
 * FR-3/FR-4, issue #21). A filter combination matching nothing returns
 * `[]`, not an error (FS-01 §10, AC-10) — the empty state is a UI concern
 * for the caller, not a rejected request.
 */
export function listBookings(params: ListBookingsParams = {}): Promise<BookingOverviewItem[]> {
  const query = buildQuery({
    date: params.date,
    resourceId: params.resourceId,
    bookedById: params.bookedById,
    bookedForId: params.bookedForId,
  });
  return apiFetch<BookingOverviewItem[]>(`/api/bookings${query}`);
}

/** Request body for {@link createBooking} (FS-02 FR-1, issue #36). */
export interface CreateBookingInput {
  resourceId: string;
  bookedForId: string;
  purposeId: string;
  /** Local Europe/Berlin wall-clock time, as typed by the user — not yet
   * resolved to an instant. The backend resolves and validates it
   * (FS-02 FR-2 R-1–R-4); this helper does not reformat or coerce it. */
  start: string;
  end: string;
}

/**
 * `POST /api/bookings` — create one booking (FS-02 FR-1/FR-5, issue #36).
 *
 * `bookedBy` is never part of the request: the backend always attributes
 * the booking to the current person (`GET /api/me`), so there is nothing
 * for this helper to send for it.
 *
 * Rejects with an `ApiError`:
 *  - `isValidationError` — malformed input or a failed FS-02 rule
 *    (`fieldErrors` keyed by `resourceId`/`bookedForId`/`purposeId`/
 *    `start`/`end`).
 *  - `isConflict` — the slot clashes with an existing booking (FS-03);
 *    `fieldErrors` carries `start`/`end` entries with a `conflict` range.
 *  - `isUnexpected` — availability could not be confirmed, or another
 *    server failure.
 */
export function createBooking(input: CreateBookingInput): Promise<BookingDetail> {
  return apiFetch<{ booking: BookingDetail }>('/api/bookings', {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((response) => response.booking);
}

/**
 * `GET /api/bookings/:id` — a single booking's detail (FS-02 FR-3/§6.3,
 * issue #37). `canCancel` is computed server-side (`bookedBy === current
 * person`) — the view renders/hides the cancel action from this flag
 * rather than re-deriving the permission itself.
 *
 * Rejects with an `ApiError` whose `isNotFound` is `true` when the id is
 * malformed or does not identify an existing booking.
 */
export function getBooking(id: string): Promise<{ booking: BookingDetail; canCancel: boolean }> {
  return apiFetch<{ booking: BookingDetail; canCancel: boolean }>(
    `/api/bookings/${encodeURIComponent(id)}`,
  );
}

/**
 * `DELETE /api/bookings/:id` — cancel a booking (FS-02 FR-3/§6.3, issue
 * #37). Responds `204 No Content` on success — see `apiFetch`'s
 * short-circuit for that status — so this resolves to `void`, not a
 * booking body (the booking no longer exists to describe).
 *
 * Rejects with an `ApiError`:
 *  - `isNotFound` — already cancelled/unknown id (safe to treat as
 *    "already gone", not a failure to retry).
 *  - `isForbidden` — the current person did not create this booking.
 */
export function cancelBooking(id: string): Promise<void> {
  return apiFetch<void>(`/api/bookings/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
