import { describe, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { now, withClock } from './clock';
import { parseDayBounds } from './dayQuery';
import { validateBookingInput } from './bookingRules';

describe('injected application clock', () => {
  it('uses the injected instant in validation without changing the system clock', () => {
    const fixed = Temporal.Instant.from('2026-08-31T10:00:00Z');
    withClock(() => fixed, () => {
      expect(now().equals(fixed)).toBe(true);
      expect(() => validateBookingInput({
        resourceId: 'resource', bookedForId: 'person', purpose: 'Meeting',
        start: '2026-08-31T11:00', end: '2026-08-31T12:00',
      })).toThrow();
      expect(parseDayBounds(undefined)).toEqual(parseDayBounds('2026-08-31'));
    });
    expect(now().equals(fixed)).toBe(false);
  });
});
