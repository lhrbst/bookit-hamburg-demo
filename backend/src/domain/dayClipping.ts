import { Temporal } from '@js-temporal/polyfill';

/**
 * Day-clipping logic shared by every "bookings for a calendar day" read
 * (today overview — this ticket; the per-resource schedule — issue #53).
 *
 * A booking that spans midnight is returned for every calendar day it
 * overlaps (FS-01 FR-2, AC-13), showing only the portion occupying that
 * day. This module clips a booking's absolute instant range to a single
 * day's boundaries and reports whether the *actual* booking extends
 * beyond that day in either direction, so the UI can render "continues
 * from before" / "continues after" indicators without losing the
 * original range.
 */

export interface DayBounds {
  /** Inclusive start instant of the calendar day, in Europe/Berlin. */
  start: Temporal.Instant;
  /** Exclusive end instant of the calendar day (the following midnight). */
  end: Temporal.Instant;
}

export interface ClippedRange {
  /** Booking start, clipped to the day's boundaries, ISO-8601 with offset. */
  start: string;
  /** Booking end, clipped to the day's boundaries, ISO-8601 with offset. */
  end: string;
  /** True when the booking's actual start is earlier than the day's start. */
  continuesFromPreviousDay: boolean;
  /** True when the booking's actual end is later than the day's end. */
  continuesIntoNextDay: boolean;
}

/**
 * Resolves the `[start, end)` instant boundaries of a single Europe/Berlin
 * calendar day for `date`.
 *
 * DST transitions in Europe/Berlin never land on midnight, so this
 * conversion is unambiguous and never needs `disambiguation: 'reject'` —
 * unlike parsing a user-supplied local time, which is handled elsewhere
 * (booking creation, issue #33).
 */
export function dayBounds(date: Temporal.PlainDate): DayBounds {
  const startOfDay = date.toZonedDateTime({
    timeZone: 'Europe/Berlin',
    plainTime: Temporal.PlainTime.from('00:00'),
  });
  const startOfNextDay = date
    .add({ days: 1 })
    .toZonedDateTime({
      timeZone: 'Europe/Berlin',
      plainTime: Temporal.PlainTime.from('00:00'),
    });

  return {
    start: startOfDay.toInstant(),
    end: startOfNextDay.toInstant(),
  };
}

/**
 * Clips a booking's absolute `[bookingStart, bookingEnd)` instant range to
 * `bounds`, and reports whether the actual booking extends past either
 * boundary.
 *
 * Callers are expected to have already filtered to bookings whose range
 * overlaps `bounds` (e.g. via the `&&` operator in SQL); this function
 * does not itself check for overlap and will return an inverted/empty
 * range if given a booking that does not overlap the day at all.
 */
export function clipToDay(
  bookingStart: Temporal.Instant,
  bookingEnd: Temporal.Instant,
  bounds: DayBounds,
): ClippedRange {
  const continuesFromPreviousDay = Temporal.Instant.compare(bookingStart, bounds.start) < 0;
  const continuesIntoNextDay = Temporal.Instant.compare(bookingEnd, bounds.end) > 0;

  const clippedStart = continuesFromPreviousDay ? bounds.start : bookingStart;
  const clippedEnd = continuesIntoNextDay ? bounds.end : bookingEnd;

  return {
    start: clippedStart.toString(),
    end: clippedEnd.toString(),
    continuesFromPreviousDay,
    continuesIntoNextDay,
  };
}
