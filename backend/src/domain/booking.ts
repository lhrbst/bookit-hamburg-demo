/**
 * Booking domain model (FS-02 §7 — the authoritative field set for a
 * booking; FS-01 §7 described only the read-side subset).
 *
 * All six fields are required. `bookedBy` and `bookedFor` are independent
 * references into the maintained set of people — they may be the same
 * person or different people. `start`/`end` are absolute instants
 * (ISO-8601 with offset), not local wall-clock strings: local-time parsing
 * and DST validity are a boundary concern of the API layer (issue #33),
 * not of this domain model.
 */
export interface Booking {
  id: string;
  resourceId: string;
  bookedBy: string;
  bookedFor: string;
  purpose: string;
  /** Inclusive start instant, ISO-8601 with offset. */
  start: string;
  /** Exclusive end instant, ISO-8601 with offset. */
  end: string;
}

/**
 * Input to `createBooking`. Deliberately unvalidated at this layer:
 * end-after-start, not-in-the-past, valid-purpose, and DST rejection are
 * booking validity rules layered on in issue #33, and the non-overlap
 * clash rule is enforced by the database exclusion constraint
 * (`booking_no_overlap`, ADR-003) rather than here.
 */
export interface CreateBookingInput {
  resourceId: string;
  bookedBy: string;
  bookedFor: string;
  purpose: string;
  /** Start instant, ISO-8601 with offset — already resolved from local time. */
  start: string;
  /** End instant, ISO-8601 with offset — already resolved from local time. */
  end: string;
}

/**
 * A single named party (resource or person) as embedded in a booking read
 * response — just enough identity to render and to link back, without
 * pulling in the full `Resource`/`Person` shape (FS-01 §7/FR-4).
 */
export interface BookingResourceSummary {
  id: string;
  name: string;
  type: 'room' | 'equipment';
}

export interface BookingPersonSummary {
  id: string;
  name: string;
}

/**
 * Response item for a day-scoped booking read (`GET /api/bookings`, issue
 * #21; `GET /api/resources/:id/schedule`, issue #53). `start`/`end` are
 * already clipped to the requested calendar day (see `dayClipping.ts`);
 * `continuesFromPreviousDay`/`continuesIntoNextDay` say whether the
 * underlying booking extends beyond that day's boundaries.
 */
export interface BookingOverviewItem {
  id: string;
  resource: BookingResourceSummary;
  start: string;
  end: string;
  bookedBy: BookingPersonSummary;
  bookedFor: BookingPersonSummary;
  continuesFromPreviousDay: boolean;
  continuesIntoNextDay: boolean;
}

/** A booking purpose as embedded in a single-booking read response. */
export interface BookingPurposeSummary {
  id: string;
  label: string;
}

/**
 * Response shape for a single booking, joined with resource/person/purpose
 * identity (`GET /api/bookings/:id`, issue #37; the same shape underlies
 * `POST /api/bookings`'s create response, issue #36). Unlike
 * `BookingOverviewItem`, `start`/`end` here are the booking's true
 * (unclipped) instants — there is no calendar-day window to clip against
 * for a single-booking read.
 */
export interface BookingDetail {
  id: string;
  resource: BookingResourceSummary;
  bookedBy: BookingPersonSummary;
  bookedFor: BookingPersonSummary;
  purpose: BookingPurposeSummary;
  start: string;
  end: string;
}
