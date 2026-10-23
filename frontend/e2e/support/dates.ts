/**
 * Test-side Europe/Berlin day-key helper.
 *
 * Deliberately re-implemented here (rather than importing
 * `frontend/src/lib/dates.ts#todayInBerlin`) so that a bug in the app's
 * own date module cannot silently make its test agree with itself — the
 * test computes "today in Berlin" independently, using the same
 * `Intl.DateTimeFormat` primitive the app is documented to rely on, and
 * asserts the app's rendered URL matches it.
 */
const berlinDayKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's calendar day in Europe/Berlin, as `YYYY-MM-DD`. */
export function todayInBerlin(): string {
  return berlinDayKeyFormatter.format(new Date());
}

/**
 * Test-side Europe/Berlin wall-clock time formatter (`HH:mm`, 24h),
 * independently re-implemented (see module doc above) from
 * `frontend/src/lib/dates.ts#formatBerlinTime` so that the segment
 * rendering assertions in `resource-schedule-segments.spec.ts` don't just
 * check the app agrees with itself.
 */
const berlinTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Formats an ISO instant as a Berlin wall-clock `HH:mm` time. */
export function formatBerlinTime(isoInstant: string): string {
  return berlinTimeFormatter.format(new Date(isoInstant));
}

const berlinLocalDateTimeParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/**
 * Formats an instant as the bare Europe/Berlin local wall-clock string
 * (`YYYY-MM-DDTHH:mm`, no offset/zone) the backend's booking contract
 * requires and a native `datetime-local` input's `.value` already is —
 * used by `booking-form.spec.ts` (issue #40) to build fixture start/end
 * times that are always "the future" regardless of when the suite runs,
 * without ever depending on the real wall clock for what the test means.
 */
export function berlinLocalDateTimeInput(instant: Date): string {
  const parts = Object.fromEntries(
    berlinLocalDateTimeParts.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/**
 * Test-side Europe/Berlin full date+time formatter, e.g. `"1 Sept 2026,
 * 09:00"` — independently re-implemented (see module doc above) from
 * `frontend/src/lib/dates.ts#formatBerlinDateTime`, so `cancel-booking-
 * dialog.spec.ts` (issue #43) can compute the exact text it expects the
 * booking detail `<dl>` and the cancel confirmation dialog to both show,
 * without importing (and thus silently trusting) the app's own module.
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

/** Formats an ISO instant as a full Berlin wall-clock date+time. */
export function formatBerlinDateTime(isoInstant: string): string {
  return berlinDateTimeFormatter.format(new Date(isoInstant));
}
