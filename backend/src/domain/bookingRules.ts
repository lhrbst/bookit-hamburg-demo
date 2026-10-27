import { Temporal } from '@js-temporal/polyfill';
import { ValidationError, type FieldError } from './errors';
import { isValidPurpose } from './purposes';
import { parseBerlinLocalDateTime } from './datetime';
import { now } from './clock';

/**
 * Booking validity rules (FS-02 FR-2, R-1 to R-4; FR-4; AC-3/AC-4/AC-5/
 * AC-5a/AC-6/AC-7).
 *
 * This module runs *before* the FS-03 clash check (issues #47/#48): it
 * decides whether a proposed booking is well-formed and legal on its own
 * terms, independent of whether any other booking exists. It is a pure
 * function — no HTTP request, no database access, no side effects — so it
 * is unit-testable in isolation and reusable by `POST /api/bookings`
 * (issue #36) without any HTTP-layer translation.
 *
 * All failing rules are accumulated and reported together (not just the
 * first), because the form should be able to show every problem at once.
 * `ValidationError#fieldErrors` carries an array of `{ field, rule,
 * message }` entries (issue #38) — general enough for a field to carry
 * more than one simultaneous violation, though nothing in this function
 * currently produces two entries for the same field (every check below
 * is guarded against that; see the note on `validateBookingInput`) — so
 * issue #36 can forward this function's exception straight into the
 * existing error-handling middleware.
 *
 * Deliberately NOT implemented here (out of scope for this ticket):
 *  - The FS-03 non-overlap/clash rule — enforced by the database
 *    exclusion constraint, not read-then-check application code.
 *  - FS-02 §12 Q1 (minimum/maximum duration, fixed increments) and Q4 (how
 *    far ahead a booking may be made) — both open questions, unanswered.
 *    Adding them later means extending this module only.
 */

/** Raw, unvalidated booking creation input as received from the caller. */
export interface BookingRuleInput {
  resourceId?: string;
  bookedForId?: string;
  purpose?: string;
  /** Europe/Berlin local date-time, e.g. `2026-06-01T14:00`. */
  start?: string;
  /** Europe/Berlin local date-time, e.g. `2026-06-01T15:00`. */
  end?: string;
}

/** Booking input that has passed every FS-02 FR-2 validity rule. */
export interface ValidatedBooking {
  resourceId: string;
  bookedForId: string;
  purpose: string;
  /** Absolute start instant, ISO-8601 with offset. */
  start: string;
  /** Absolute end instant, ISO-8601 with offset. */
  end: string;
}

const REQUIRED_FIELDS: Array<keyof BookingRuleInput> = [
  'resourceId',
  'bookedForId',
  'purpose',
  'start',
  'end',
];

function isMissing(value: string | undefined): value is undefined {
  return value === undefined || value.trim() === '';
}

const DST_MESSAGE =
  'That local time is not valid in Europe/Berlin because of a daylight-saving clock change. Choose a different, unambiguous local time.';

/**
 * Validates a proposed booking against every FS-02 FR-2 rule (R-1 to R-4),
 * plus required-field presence (AC-7), collecting *all* failing rules in
 * one pass.
 *
 * On success returns the booking with `start`/`end` resolved to absolute
 * instants (ISO-8601 with offset), ready for `db/bookingRepository.ts` to
 * insert into the `tstzrange` column. On failure throws `ValidationError`
 * with one `FieldError` per failing rule — `resourceId`, `bookedForId`,
 * `purpose`, `start`, and/or `end` — never stopping at the first problem.
 *
 * At most one `FieldError` is ever produced for a given field by this
 * function: every check below is guarded (a DST/range check is only
 * attempted once the field is present and required-field-complete; R-1
 * and R-2 only run once the field parsed to a `ZonedDateTime`, which
 * already rules out a simultaneous "required"/"invalid"/DST error on the
 * same field) so no field is ever overwritten or duplicated. The response
 * shape (`ValidationError#fieldErrors: FieldError[]`) is still a general
 * array, not a one-entry-per-field map, because nothing about the wire
 * contract should assume that stays true if a future rule is added.
 */
export function validateBookingInput(input: BookingRuleInput): ValidatedBooking {
  const fieldErrors: FieldError[] = [];

  // --- Required-field presence (AC-7) ---------------------------------
  for (const field of REQUIRED_FIELDS) {
    if (isMissing(input[field])) {
      fieldErrors.push({ field, rule: 'required', message: `${field} is required.` });
    }
  }

  // --- R-3 — Valid purpose ---------------------------------------------
  if (!isMissing(input.purpose) && !isValidPurpose(input.purpose)) {
    fieldErrors.push({
      field: 'purpose',
      rule: 'valid-purpose',
      message: 'Purpose must be one of the configured categories.',
    });
  }

  // --- R-4 — Valid, unambiguous Europe/Berlin local time (start/end) ---
  // Only attempted when the field is present; a missing field already has
  // a "required" error above and does not need a second, confusing one.
  let startZoned: Temporal.ZonedDateTime | undefined;
  let endZoned: Temporal.ZonedDateTime | undefined;

  if (!isMissing(input.start)) {
    const parsed = parseBerlinLocalDateTime(input.start);
    if (parsed.ok) {
      startZoned = parsed.zonedDateTime;
    } else if (parsed.reason === 'invalid') {
      fieldErrors.push({
        field: 'start',
        rule: 'invalid-datetime',
        message: 'start must be a valid date and time (e.g. 2026-06-01T14:00).',
      });
    } else {
      fieldErrors.push({
        field: 'start',
        rule: parsed.reason === 'nonexistent' ? 'nonexistent-local-time' : 'ambiguous-local-time',
        message: DST_MESSAGE,
      });
    }
  }

  if (!isMissing(input.end)) {
    const parsed = parseBerlinLocalDateTime(input.end);
    if (parsed.ok) {
      endZoned = parsed.zonedDateTime;
    } else if (parsed.reason === 'invalid') {
      fieldErrors.push({
        field: 'end',
        rule: 'invalid-datetime',
        message: 'end must be a valid date and time (e.g. 2026-06-01T15:00).',
      });
    } else {
      fieldErrors.push({
        field: 'end',
        rule: parsed.reason === 'nonexistent' ? 'nonexistent-local-time' : 'ambiguous-local-time',
        message: DST_MESSAGE,
      });
    }
  }

  // --- R-1 — End strictly after start -----------------------------------
  // Compared as absolute instants, never as calendar dates/times, so a
  // booking that crosses midnight (e.g. 23:00 -> 01:00) is judged purely
  // on duration, not on same-day wall-clock arithmetic (AC-6).
  if (startZoned && endZoned && Temporal.ZonedDateTime.compare(endZoned, startZoned) <= 0) {
    fieldErrors.push({
      field: 'end',
      rule: 'end-after-start',
      message: 'The end time must be later than the start time.',
    });
  }

  // --- R-2 — Not in the past ---------------------------------------------
  // Evaluated against "now" at the moment this function runs, never a
  // value captured earlier (e.g. at module load or form open), so a form
  // left open until its start time passes still fails here.
  if (startZoned) {
    const currentTime = now().toZonedDateTimeISO('Europe/Berlin');
    if (Temporal.ZonedDateTime.compare(startZoned, currentTime) < 0) {
      fieldErrors.push({
        field: 'start',
        rule: 'not-in-past',
        message: 'Bookings cannot be made in the past.',
      });
    }
  }

  if (fieldErrors.length > 0) {
    throw new ValidationError(fieldErrors);
  }

  // The presence checks above guarantee these are defined; the field
  // errors accumulator would have thrown otherwise.
  return {
    resourceId: input.resourceId as string,
    bookedForId: input.bookedForId as string,
    purpose: input.purpose as string,
    start: (startZoned as Temporal.ZonedDateTime).toInstant().toString(),
    end: (endZoned as Temporal.ZonedDateTime).toInstant().toString(),
  };
}
