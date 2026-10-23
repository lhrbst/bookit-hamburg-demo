import { Temporal } from '@js-temporal/polyfill';
import { clipToDay, type DayBounds } from './dayClipping';
import type { BookingPersonSummary } from './booking';

/**
 * Segment-building logic for `GET /api/resources/:id/schedule` (FS-01
 * FR-2, §6.2, §7, §10, AC-2/AC-3/AC-4/AC-12/AC-13, issue #53).
 *
 * Turns a resource's raw bookings for one calendar day into an ordered,
 * gap-free partition of the full 24 hours into `booked` and `free`
 * segments — the shape the resource-schedule UI renders directly.
 */

export interface ResourceBookingForSchedule {
  /** The booking's own id, threaded through into `BookedSegment.id`. */
  id: string;
  /** Actual (unclipped) booking start instant. */
  start: Temporal.Instant;
  /** Actual (unclipped) booking end instant. */
  end: Temporal.Instant;
  bookedBy: BookingPersonSummary;
  bookedFor: BookingPersonSummary;
}

export interface ScheduleFilters {
  bookedById: string | undefined;
  bookedForId: string | undefined;
}

export interface BookedSegment {
  type: 'booked';
  id: string;
  start: string;
  end: string;
  bookedBy: BookingPersonSummary;
  bookedFor: BookingPersonSummary;
  continuesFromPreviousDay: boolean;
  continuesIntoNextDay: boolean;
}

export interface FreeSegment {
  type: 'free';
  start: string;
  end: string;
}

export type ScheduleSegment = BookedSegment | FreeSegment;

/**
 * Builds the ordered list of segments covering the full `bounds` day for
 * one resource.
 *
 * `bookings` must be *every* real booking on the resource overlapping the
 * day, regardless of `filters` — free-segment coverage is always computed
 * against that unfiltered set (FS-01 §10: "time released by filtering out
 * a booking is rendered as free", not as a gap). `filters` only decides
 * which bookings are allowed to render as a `booked` segment; a booking
 * excluded by the filters still occupies its slot, just as a `free`
 * segment instead of disappearing and leaving a hole in the 24 hours.
 *
 * Each booking is clipped to the day via `clipToDay` (AC-13) before being
 * placed. Back-to-back bookings (one ending exactly as the next begins)
 * are never merged and never separated by a zero-length free segment,
 * because a free segment is only inserted when there is a strictly
 * positive gap between the end of one clipped range and the start of the
 * next.
 */
export function buildResourceSchedule(
  bookings: ResourceBookingForSchedule[],
  bounds: DayBounds,
  filters: ScheduleFilters,
): ScheduleSegment[] {
  const sorted = [...bookings].sort((a, b) => Temporal.Instant.compare(a.start, b.start));

  const segments: ScheduleSegment[] = [];
  let cursor = bounds.start;

  for (const booking of sorted) {
    const clipped = clipToDay(booking.start, booking.end, bounds);
    const clippedStart = Temporal.Instant.from(clipped.start);
    const clippedEnd = Temporal.Instant.from(clipped.end);

    if (Temporal.Instant.compare(clippedStart, cursor) > 0) {
      segments.push({ type: 'free', start: cursor.toString(), end: clipped.start });
    }

    if (matchesFilters(booking, filters)) {
      segments.push({
        type: 'booked',
        id: booking.id,
        start: clipped.start,
        end: clipped.end,
        bookedBy: booking.bookedBy,
        bookedFor: booking.bookedFor,
        continuesFromPreviousDay: clipped.continuesFromPreviousDay,
        continuesIntoNextDay: clipped.continuesIntoNextDay,
      });
    } else {
      // Excluded by the active bookedBy/bookedForId filter: the time it
      // occupied reverts to free rather than disappearing (FS-01 §10).
      segments.push({ type: 'free', start: clipped.start, end: clipped.end });
    }

    cursor = clippedEnd;
  }

  if (Temporal.Instant.compare(cursor, bounds.end) < 0) {
    segments.push({ type: 'free', start: cursor.toString(), end: bounds.end.toString() });
  }

  return mergeAdjacentFreeSegments(segments);
}

function matchesFilters(
  booking: ResourceBookingForSchedule,
  filters: ScheduleFilters,
): boolean {
  if (filters.bookedById !== undefined && booking.bookedBy.id !== filters.bookedById) {
    return false;
  }
  if (filters.bookedForId !== undefined && booking.bookedFor.id !== filters.bookedForId) {
    return false;
  }
  return true;
}

/**
 * Collapses consecutive `free` segments produced by an adjoining gap and a
 * filtered-out booking (or two filtered-out bookings in a row) into one,
 * so the response never carries meaningless zero-information free/free
 * boundaries. Never merges `booked` segments — those stay one-per-booking
 * regardless of adjacency (FS-01 §10, back-to-back bookings).
 */
function mergeAdjacentFreeSegments(segments: ScheduleSegment[]): ScheduleSegment[] {
  const merged: ScheduleSegment[] = [];

  for (const segment of segments) {
    const last = merged[merged.length - 1];
    if (last !== undefined && last.type === 'free' && segment.type === 'free' && last.end === segment.start) {
      last.end = segment.end;
    } else {
      merged.push({ ...segment });
    }
  }

  return merged;
}
