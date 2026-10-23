import { Temporal } from '@js-temporal/polyfill';

/**
 * Single Europe/Berlin local-time parsing module (FS-02 FR-4, R-4).
 *
 * This is the one place a user-supplied local wall-clock string is turned
 * into an absolute instant. It follows the same Temporal-based pattern
 * already established in `dayClipping.ts`/`dayQuery.ts`
 * (`overflow: 'reject'`), extended to full date-times and to
 * `disambiguation: 'reject'`, which those modules do not need because a
 * calendar-day boundary (midnight) never lands on a Europe/Berlin DST
 * transition — a submitted booking start/end time can.
 *
 * A local time is rejected, never silently coerced, when it:
 *  - does not occur at all (clocks spring forward, e.g. 2026-03-29 02:30
 *    Europe/Berlin does not exist — 02:00 jumps straight to 03:00), or
 *  - occurs twice (clocks fall back, e.g. 2026-10-25 02:30 Europe/Berlin
 *    happens once at UTC+2 and again an hour later at UTC+1).
 *
 * Accepted input shape: `YYYY-MM-DDTHH:mm` or `YYYY-MM-DD HH:mm` (seconds
 * optional), with no offset/zone — offering one is out of scope (FR-4: no
 * time zone is ever exposed to the caller).
 */

export type LocalDateTimeParseResult =
  | { ok: true; zonedDateTime: Temporal.ZonedDateTime }
  | { ok: false; reason: 'invalid' | 'nonexistent' | 'ambiguous' };

const BERLIN = 'Europe/Berlin';

/**
 * Parses `raw` as a Europe/Berlin local date-time, rejecting malformed
 * input, out-of-range calendar components, non-existent local times
 * (spring-forward gap), and ambiguous local times (fall-back overlap).
 */
export function parseBerlinLocalDateTime(raw: string | undefined): LocalDateTimeParseResult {
  if (raw === undefined || raw.trim() === '') {
    return { ok: false, reason: 'invalid' };
  }

  let plainDateTime: Temporal.PlainDateTime;
  try {
    // overflow: 'reject' refuses out-of-range components (e.g. day 31 in a
    // 30-day month) instead of silently clamping them.
    plainDateTime = Temporal.PlainDateTime.from(raw, { overflow: 'reject' });
  } catch {
    return { ok: false, reason: 'invalid' };
  }

  try {
    // disambiguation: 'reject' refuses a local time that does not exist or
    // occurs twice, instead of silently picking the earlier/later offset
    // (the polyfill's default, 'compatible', would do exactly that).
    const zonedDateTime = plainDateTime.toZonedDateTime(BERLIN, { disambiguation: 'reject' });
    return { ok: true, zonedDateTime };
  } catch {
    // Distinguish the two DST failure modes by counting candidate instants
    // for the wall-clock time: zero means it never happened (spring
    // forward), two means it happened twice (fall back).
    const timeZone = Temporal.TimeZone.from(BERLIN);
    const candidates = timeZone.getPossibleInstantsFor(plainDateTime);
    return { ok: false, reason: candidates.length === 0 ? 'nonexistent' : 'ambiguous' };
  }
}
