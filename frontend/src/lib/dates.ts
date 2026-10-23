/**
 * Europe/Berlin day-key handling (FS-01 FR-2, §12 assumptions), issue #24.
 *
 * The whole app agrees on what "a day" is by routing every calendar-day
 * computation and every wall-clock display through this one module,
 * rather than letting each view invent its own `Date`/`toISOString`
 * logic (which is UTC, not Berlin, and silently wrong near midnight).
 *
 * ## Why `Intl.DateTimeFormat` and not a new date library
 *
 * The backend uses `@js-temporal/polyfill` because it must *authoritatively
 * validate* wall-clock instants — including rejecting ambiguous/non-existent
 * local times across a DST transition. That is a validation concern; the
 * frontend has no such job (Core Rule 3 of this agent's contract: the API is
 * authoritative, the frontend's client-side logic is an affordance).
 *
 * Everything this module needs is one of two things:
 *   1. "What Y-M-D does a given *instant* (`Date.now()`, or an ISO instant
 *      from the API) fall on in Europe/Berlin, and what's the Berlin
 *      wall-clock time of day for it?" — `Intl.DateTimeFormat` with
 *      `timeZone: 'Europe/Berlin'` answers this directly and correctly,
 *      including during DST, because the browser's ICU timezone database
 *      is the same data source Temporal itself would use.
 *   2. "Given a Y-M-D day key, what's the next/previous calendar day?" —
 *      this is pure calendar arithmetic on a date triple. It has nothing to
 *      do with Berlin's UTC offset at all (see `addDays` below), so it does
 *      not need a timezone-aware library — it must not even consult the
 *      *browser's* local timezone, which `Intl` cleanly avoids by using
 *      `Date.UTC`/`getUTC*` as an inert calendar, never `Date`'s local
 *      getters/setters.
 *
 * No correctness gap requires a second date dependency. If a future ticket
 * needs to reason about Berlin wall-clock arithmetic (e.g. "9am + 3 hours
 * in Berlin, spanning a DST change"), that would be a genuine gap and a
 * fresh dependency decision — not needed here.
 */

const DAY_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface DayParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

/**
 * Formats today's Europe/Berlin calendar date as a `YYYY-MM-DD` key,
 * independent of the browser's own configured time zone.
 *
 * `en-CA` is used purely as a formatting trick: that locale's convention
 * happens to render `year`/`month`/`day` parts in `YYYY-MM-DD` order with
 * zero-padding, so we can lean on the platform formatter instead of
 * hand-assembling the string from `formatToParts` (equivalent, less code).
 * The `timeZone: 'Europe/Berlin'` option is what actually does the work —
 * it converts the current instant (`Date.now()`, always a UTC instant
 * under the hood) into Berlin wall-clock date parts, not the browser's
 * local ones.
 */
const berlinDayKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * A 24-hour Berlin wall-clock time-of-day formatter, e.g. `"14:00"`. Used
 * for displaying a booking's start/end — never the browser's local zone.
 */
const berlinTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * A full Berlin wall-clock date+time formatter, e.g. `"1 Sept 2026,
 * 09:00"`. Unlike `berlinTimeFormatter` (time-of-day only, correct for
 * views already scoped to one known calendar day, such as the resource
 * schedule), the booking detail view (issue #41) is not scoped to a
 * single day the user already picked — a booking's start and end may
 * even fall on different calendar days — so its display must always
 * spell out the date alongside the time. No `timeZoneName` part is
 * included: AC-11 requires local time with no time-zone indicator, and
 * this app never offers a time-zone choice.
 */
const berlinDateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * A Berlin wall-clock date+time formatter whose parts are extracted via
 * `formatToParts` and reassembled into the exact `YYYY-MM-DDTHH:mm` shape
 * a native `<input type="datetime-local">` element's `value` requires
 * (issue #44 — pre-filling the booking form's start/end from a resource
 * schedule's free segment). `hourCycle: 'h23'` is set explicitly (rather
 * than relying on `hour12: false`'s locale-dependent default) so
 * midnight is always rendered as `00`, never `24`.
 */
const berlinDateTimeLocalPartsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  hourCycle: 'h23',
});

/**
 * Converts an ISO instant (as returned by the backend) to the Berlin
 * wall-clock `YYYY-MM-DDTHH:mm` string a `datetime-local` input's `value`
 * expects — the exact inverse of what that input already produces when
 * the user types into it (see `BookingFormRoute`'s doc comment on why no
 * further reformatting happens on submit). Used ONLY to pre-fill a
 * convenience default from a free schedule segment's start/end (issue
 * #44) — the user can still edit the pre-filled value before submitting.
 */
export function toBerlinDateTimeLocalInputValue(isoInstant: string): string {
  const parts = berlinDateTimeLocalPartsFormatter.formatToParts(new Date(isoInstant));
  const lookup: Record<string, string> = {};
  for (const part of parts) {
    lookup[part.type] = part.value;
  }
  return `${lookup.year}-${lookup.month}-${lookup.day}T${lookup.hour}:${lookup.minute}`;
}

/** Today's Europe/Berlin calendar date as a `YYYY-MM-DD` key. */
export function todayInBerlin(): string {
  return berlinDayKeyFormatter.format(new Date());
}

/**
 * The Europe/Berlin calendar day (`YYYY-MM-DD`) an ISO instant falls on —
 * e.g. for linking from a booking (whose own start may not be today) back
 * to the resource schedule day where it is actually visible (issue #42).
 */
export function berlinDayKeyOf(isoInstant: string): string {
  return berlinDayKeyFormatter.format(new Date(isoInstant));
}

/**
 * Formats an ISO instant (as returned by the backend for booking
 * start/end) as a Berlin wall-clock `HH:mm` time.
 */
export function formatBerlinTime(isoInstant: string): string {
  return berlinTimeFormatter.format(new Date(isoInstant));
}

/**
 * Formats an ISO instant as a full Berlin wall-clock date+time, e.g.
 * `"1 Sept 2026, 09:00"` — for views (like the booking detail view, issue
 * #41) that display a booking outside the context of one already-known
 * calendar day. Never shows a time-zone abbreviation/offset (AC-11).
 */
export function formatBerlinDateTime(isoInstant: string): string {
  return berlinDateTimeFormatter.format(new Date(isoInstant));
}

/**
 * Validates the *shape* of a day key and, if well-formed, returns its
 * parts. This is a lightweight frontend affordance only — good enough to
 * reject obviously malformed input (`2026-13-40`, `not-a-date`) before it
 * is even sent to the API — not a substitute for the backend's own
 * authoritative validation.
 *
 * Uses a `Date.UTC` round-trip (rather than hand-written month/day range
 * checks) so `2026-02-30` is also rejected: if the parts don't survive
 * being written to and read back from a UTC calendar unchanged, the key
 * doesn't name a real calendar day.
 */
export function parseDay(key: string): DayParts | null {
  const match = DAY_KEY_PATTERN.exec(key);
  if (match === null) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const utc = Date.UTC(year, month - 1, day);
  const roundTrip = new Date(utc);
  const isRealCalendarDay =
    roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() === month - 1 &&
    roundTrip.getUTCDate() === day;

  return isRealCalendarDay ? { year, month, day } : null;
}

/** True when `key` is a well-formed `YYYY-MM-DD` calendar day. */
export function isValidDayKey(key: string): boolean {
  return parseDay(key) !== null;
}

function formatDayKey(parts: DayParts): string {
  const year = String(parts.year).padStart(4, '0');
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Moves a `YYYY-MM-DD` day key forward/backward by exactly `delta`
 * calendar days, correct across month, year, and Europe/Berlin DST
 * boundaries.
 *
 * The key insight: "add one calendar day" is calendar arithmetic on a
 * Y-M-D triple, not an operation on a Berlin wall-clock *instant*. It does
 * not matter whether 25 October (Berlin's autumn clock change, a 25-hour
 * day) or 29 March (Berlin's spring change, a 23-hour day) has an odd
 * number of wall-clock hours — the *next calendar date* is still simply
 * "the next entry in the calendar", unaffected by how long that day was
 * in wall-clock hours. So this function performs the arithmetic on an
 * inert UTC-anchored `Date` used purely as a calendar (`Date.UTC` /
 * `getUTC*`), which never consults the *browser's own* local time zone —
 * that would be the actual bug this function must avoid (an
 * implementation using `new Date(y, m, d)` and `.getDate()`/`.setDate()`,
 * i.e. the browser's local getters/setters, would be silently wrong for a
 * browser configured in a DST-observing zone whose transition dates
 * don't line up with Berlin's).
 */
export function addDays(dayKey: string, delta: number): string {
  const parts = parseDay(dayKey);
  if (parts === null) {
    throw new RangeError(`addDays: "${dayKey}" is not a valid YYYY-MM-DD day key`);
  }
  const utcMillis = Date.UTC(parts.year, parts.month - 1, parts.day) + delta * 86_400_000;
  const moved = new Date(utcMillis);
  return formatDayKey({
    year: moved.getUTCFullYear(),
    month: moved.getUTCMonth() + 1,
    day: moved.getUTCDate(),
  });
}

/** A booking-like entry carrying the two continuation flags. */
export interface ContinuationFlags {
  continuesFromPreviousDay: boolean;
  continuesIntoNextDay: boolean;
}

/**
 * Produces an unambiguous textual label for a booking segment/overview
 * entry that only occupies *part* of the selected day because it spans a
 * calendar-day boundary (FS-01 AC-13, §10 "Booking spans calendar days").
 *
 * Returns `null` when the entry does not cross a day boundary — callers
 * should render nothing extra in that case, not an empty label element.
 * The wording is deliberately explicit ("this booking continues …") so a
 * screen reader user is told *why* the displayed time range looks partial,
 * rather than being left to infer a truncation.
 */
export function formatContinuationLabel(entry: ContinuationFlags): string | null {
  const { continuesFromPreviousDay, continuesIntoNextDay } = entry;
  if (continuesFromPreviousDay && continuesIntoNextDay) {
    return 'This booking continues from the previous day and continues into the next day.';
  }
  if (continuesFromPreviousDay) {
    return 'This booking continues from the previous day.';
  }
  if (continuesIntoNextDay) {
    return 'This booking continues into the next day.';
  }
  return null;
}
