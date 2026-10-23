/**
 * Shared response shapes for the backend's read endpoints (FS-01 §7).
 *
 * These mirror the backend's domain types (`backend/src/domain/resource.ts`,
 * `person.ts`, `booking.ts`, `schedule.ts`) field-for-field. Kept as a
 * separate module (rather than inline in each `lib/*.ts` helper) so every
 * caller shares one definition instead of drifting copies.
 */

export interface Resource {
  id: string;
  name: string;
  type: 'room' | 'equipment';
  description: string;
}

export interface Person {
  id: string;
  name: string;
}

export interface BookingResourceSummary {
  id: string;
  name: string;
  type: 'room' | 'equipment';
}

export interface BookingPersonSummary {
  id: string;
  name: string;
}

/** One entry in the today overview (`GET /api/bookings`). */
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

/**
 * One segment of a resource's day (`GET /api/resources/:id/schedule`).
 *
 * `id` was added to the backend's `BookedSegment` by issue #54 specifically
 * so this segment could link to its own booking detail view (issue #55,
 * completing the half of issue #44 that had to be deferred).
 */
export interface BookedScheduleSegment {
  type: 'booked';
  id: string;
  start: string;
  end: string;
  bookedBy: BookingPersonSummary;
  bookedFor: BookingPersonSummary;
  continuesFromPreviousDay: boolean;
  continuesIntoNextDay: boolean;
}

export interface FreeScheduleSegment {
  type: 'free';
  start: string;
  end: string;
}

export type ScheduleSegment = BookedScheduleSegment | FreeScheduleSegment;

export interface ResourceSchedule {
  resource: Resource;
  segments: ScheduleSegment[];
}

/** A booking purpose as embedded in a single-booking read/create response. */
export interface BookingPurposeSummary {
  id: string;
  label: string;
}

/**
 * Full single-booking shape (`POST /api/bookings`'s create response body,
 * and `GET /api/bookings/:id`'s `booking` field — issues #36/#37). Unlike
 * `BookingOverviewItem`, `start`/`end` here are the booking's true
 * (unclipped) instants; there is no calendar-day window to clip against
 * for a single-booking read (mirrors `backend/src/domain/booking.ts`'s
 * `BookingDetail`).
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

/** A predefined purpose category (`GET /api/purposes`, issue #34). */
export interface Purpose {
  id: string;
  label: string;
}
