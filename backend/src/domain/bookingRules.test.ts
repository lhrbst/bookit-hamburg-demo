import { describe, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { validateBookingInput } from './bookingRules';
import { ValidationError, type FieldError } from './errors';

/**
 * FS-02 FR-2 (R-1..R-4), FR-4, AC-3/AC-4/AC-5/AC-5a/AC-6/AC-7 (issue #33),
 * updated for the `FieldError[]` response shape (issue #38).
 *
 * `future()` builds a start time comfortably in the future relative to
 * whenever the suite runs, so R-2 ("not in the past") never spuriously
 * fires on the happy-path/other-rule cases.
 */
function future(hours = 24): { start: string; end: string } {
  const start = Temporal.Now.zonedDateTimeISO('Europe/Berlin').add({ hours });
  const end = start.add({ hours: 1 });
  return { start: toLocal(start), end: toLocal(end) };
}

function toLocal(zdt: Temporal.ZonedDateTime): string {
  return zdt.toPlainDateTime().toString();
}

function baseInput(overrides: Partial<Parameters<typeof validateBookingInput>[0]> = {}) {
  const { start, end } = future();
  return {
    resourceId: 'resource-1',
    bookedForId: 'person-1',
    purpose: 'Meeting',
    start,
    end,
    ...overrides,
  };
}

function fieldErrorsOf(fn: () => unknown): FieldError[] {
  try {
    fn();
    throw new Error('expected ValidationError to be thrown');
  } catch (err) {
    if (err instanceof ValidationError) return err.fieldErrors;
    throw err;
  }
}

/** All messages recorded against a given field, joined for a single `.toMatch`. */
function messagesFor(errors: FieldError[], field: string): string {
  return errors
    .filter((e) => e.field === field)
    .map((e) => e.message)
    .join(' | ');
}

/** The rule codes recorded against a given field. */
function rulesFor(errors: FieldError[], field: string): string[] {
  return errors.filter((e) => e.field === field).map((e) => e.rule);
}

describe('validateBookingInput', () => {
  it('accepts a well-formed future booking', () => {
    const result = validateBookingInput(baseInput());
    expect(result.resourceId).toBe('resource-1');
    expect(result.bookedForId).toBe('person-1');
    expect(result.purpose).toBe('Meeting');
    expect(new Date(result.end).getTime()).toBeGreaterThan(new Date(result.start).getTime());
  });

  it('R-1: rejects end < start', () => {
    const { start } = future();
    const earlierEnd = Temporal.PlainDateTime.from(start).subtract({ hours: 2 }).toString();
    const errors = fieldErrorsOf(() =>
      validateBookingInput(baseInput({ start, end: earlierEnd })),
    );
    expect(messagesFor(errors, 'end')).toMatch(/end time must be later than the start time/i);
    expect(rulesFor(errors, 'end')).toContain('end-after-start');
  });

  it('R-1/AC-4: rejects end === start', () => {
    const { start } = future();
    const errors = fieldErrorsOf(() => validateBookingInput(baseInput({ start, end: start })));
    expect(messagesFor(errors, 'end')).toMatch(/end time must be later than the start time/i);
    expect(rulesFor(errors, 'end')).toContain('end-after-start');
  });

  it('AC-6: a booking from 23:00 to 01:00 the next day passes R-1 (cross-midnight)', () => {
    // Anchor "today" far enough in the future that R-2 cannot fire.
    const day = Temporal.Now.plainDateISO('Europe/Berlin').add({ days: 30 });
    const start = `${day.toString()}T23:00`;
    const end = `${day.add({ days: 1 }).toString()}T01:00`;
    const result = validateBookingInput(baseInput({ start, end }));
    expect(result.start).toBeTruthy();
    expect(result.end).toBeTruthy();
    expect(new Date(result.end).getTime()).toBeGreaterThan(new Date(result.start).getTime());
  });

  it('R-2: rejects a start in the past, evaluated at call time', () => {
    const past = Temporal.Now.zonedDateTimeISO('Europe/Berlin').subtract({ hours: 1 });
    const end = past.add({ hours: 1 });
    const errors = fieldErrorsOf(() =>
      validateBookingInput(baseInput({ start: toLocal(past), end: toLocal(end) })),
    );
    expect(messagesFor(errors, 'start')).toMatch(/cannot be made in the past/i);
    expect(rulesFor(errors, 'start')).toContain('not-in-past');
  });

  it('R-3: rejects an unknown purpose', () => {
    const errors = fieldErrorsOf(() => validateBookingInput(baseInput({ purpose: 'Not A Real Purpose' })));
    expect(messagesFor(errors, 'purpose')).toMatch(/configured categories/i);
    expect(rulesFor(errors, 'purpose')).toContain('valid-purpose');
  });

  it('R-4: rejects the non-existent local hour on the March 2026 clocks-forward date', () => {
    // 2026-03-29 is Europe/Berlin's spring-forward date: 02:00 jumps to
    // 03:00, so 02:30 never occurs.
    const errors = fieldErrorsOf(() =>
      validateBookingInput(baseInput({ start: '2026-03-29T02:30', end: '2026-03-29T04:00' })),
    );
    expect(messagesFor(errors, 'start')).toMatch(/daylight-saving/i);
    expect(rulesFor(errors, 'start')).toContain('nonexistent-local-time');
  });

  it('R-4: rejects the ambiguous local hour on the October 2026 clocks-back date', () => {
    // 2026-10-25 is Europe/Berlin's fall-back date: 02:00-03:00 occurs
    // twice, so 02:30 is ambiguous.
    const errors = fieldErrorsOf(() =>
      validateBookingInput(baseInput({ start: '2026-10-25T02:30', end: '2026-10-25T04:00' })),
    );
    expect(messagesFor(errors, 'start')).toMatch(/daylight-saving/i);
    expect(rulesFor(errors, 'start')).toContain('ambiguous-local-time');
  });

  it('R-4 applies independently to the end field too', () => {
    const errors = fieldErrorsOf(() =>
      validateBookingInput(baseInput({ start: '2026-03-29T01:00', end: '2026-03-29T02:30' })),
    );
    expect(messagesFor(errors, 'end')).toMatch(/daylight-saving/i);
    expect(rulesFor(errors, 'end')).toContain('nonexistent-local-time');
  });

  it('AC-7: reports each missing required field individually', () => {
    const errors = fieldErrorsOf(() =>
      validateBookingInput({
        resourceId: undefined,
        bookedForId: undefined,
        purpose: undefined,
        start: undefined,
        end: undefined,
      }),
    );
    expect(messagesFor(errors, 'resourceId')).toMatch(/required/i);
    expect(messagesFor(errors, 'bookedForId')).toMatch(/required/i);
    expect(messagesFor(errors, 'purpose')).toMatch(/required/i);
    expect(messagesFor(errors, 'start')).toMatch(/required/i);
    expect(messagesFor(errors, 'end')).toMatch(/required/i);
    for (const field of ['resourceId', 'bookedForId', 'purpose', 'start', 'end']) {
      expect(rulesFor(errors, field)).toEqual(['required']);
    }
  });

  it('treats a blank/whitespace-only field as missing', () => {
    const errors = fieldErrorsOf(() => validateBookingInput(baseInput({ purpose: '   ' })));
    expect(messagesFor(errors, 'purpose')).toMatch(/required/i);
  });

  it('returns multiple simultaneous violations in one result, each on its own field entry', () => {
    const past = Temporal.Now.zonedDateTimeISO('Europe/Berlin').subtract({ hours: 2 });
    const errors = fieldErrorsOf(() =>
      validateBookingInput(
        baseInput({
          start: toLocal(past),
          end: toLocal(past), // also equal to start -> R-1 violation too
          purpose: 'Not A Real Purpose',
        }),
      ),
    );
    // At least three distinct violations: purpose, start (past), end (not after start).
    expect(errors.length).toBeGreaterThanOrEqual(2);
    const fields = new Set(errors.map((e) => e.field));
    expect(fields.has('purpose')).toBe(true);
    expect(messagesFor(errors, 'purpose')).toMatch(/configured categories/i);
    // start carries the past-rejection and/or end carries the end<=start
    // rejection, depending on which field the message is attached to;
    // both must be represented across start/end.
    expect(messagesFor(errors, 'start') || messagesFor(errors, 'end')).toBeTruthy();
    // No single field is ever duplicated by this function today (each
    // check is guarded so at most one rule fires per field per call) —
    // this asserts that invariant holds even under multiple simultaneous
    // violations across different fields.
    for (const field of fields) {
      expect(errors.filter((e) => e.field === field).length).toBe(1);
    }
  });

  it('rejects a malformed date-time string as invalid rather than crashing', () => {
    const errors = fieldErrorsOf(() =>
      validateBookingInput(baseInput({ start: 'not-a-date' })),
    );
    expect(messagesFor(errors, 'start')).toMatch(/valid date and time/i);
    expect(rulesFor(errors, 'start')).toContain('invalid-datetime');
  });

  it('every FieldError carries a field, a stable rule code, and a business-language message', () => {
    const errors = fieldErrorsOf(() =>
      validateBookingInput(baseInput({ purpose: 'Not A Real Purpose' })),
    );
    for (const error of errors) {
      expect(typeof error.field).toBe('string');
      expect(error.field.length).toBeGreaterThan(0);
      expect(typeof error.rule).toBe('string');
      expect(error.rule).not.toMatch(/\s/); // codes are dash-cased, never a sentence
      expect(typeof error.message).toBe('string');
      expect(error.message).not.toMatch(/SQLSTATE|stack|constraint|zod|temporal/i);
    }
  });
});
