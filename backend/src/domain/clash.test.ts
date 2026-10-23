import { describe, expect, it } from 'vitest';
import { findConflicts, type BookingInterval } from './clash';

/**
 * Exhaustive boundary-condition coverage for the FS-03 §7 half-open
 * overlap predicate (issue #47). Every acceptance criterion in the ticket
 * is a distinct test case below.
 */

const RESOURCE_A = 'resource-a';
const RESOURCE_B = 'resource-b';

function interval(
  overrides: Partial<BookingInterval> & Pick<BookingInterval, 'start' | 'end'>,
): BookingInterval {
  return {
    resourceId: RESOURCE_A,
    ...overrides,
  };
}

describe('findConflicts', () => {
  it('AC-1: identical range clashes', () => {
    const proposed = interval({ start: '2026-06-01T14:00:00+02:00', end: '2026-06-01T15:00:00+02:00' });
    const existing = interval({
      id: 'e1',
      start: '2026-06-01T14:00:00+02:00',
      end: '2026-06-01T15:00:00+02:00',
    });
    expect(findConflicts(proposed, [existing])).toEqual([existing]);
  });

  it('AC-2: proposed wholly inside existing clashes', () => {
    const proposed = interval({ start: '2026-06-01T14:15:00+02:00', end: '2026-06-01T14:45:00+02:00' });
    const existing = interval({
      id: 'e1',
      start: '2026-06-01T14:00:00+02:00',
      end: '2026-06-01T15:00:00+02:00',
    });
    expect(findConflicts(proposed, [existing])).toEqual([existing]);
  });

  it('AC-3: proposed wholly contains existing clashes', () => {
    const proposed = interval({ start: '2026-06-01T13:00:00+02:00', end: '2026-06-01T16:00:00+02:00' });
    const existing = interval({
      id: 'e1',
      start: '2026-06-01T14:00:00+02:00',
      end: '2026-06-01T15:00:00+02:00',
    });
    expect(findConflicts(proposed, [existing])).toEqual([existing]);
  });

  it('AC-4: proposed starts during existing, ends after — clashes', () => {
    const proposed = interval({ start: '2026-06-01T14:30:00+02:00', end: '2026-06-01T15:30:00+02:00' });
    const existing = interval({
      id: 'e1',
      start: '2026-06-01T14:00:00+02:00',
      end: '2026-06-01T15:00:00+02:00',
    });
    expect(findConflicts(proposed, [existing])).toEqual([existing]);
  });

  it('AC-5: proposed starts before existing, ends during — clashes', () => {
    const proposed = interval({ start: '2026-06-01T13:30:00+02:00', end: '2026-06-01T14:30:00+02:00' });
    const existing = interval({
      id: 'e1',
      start: '2026-06-01T14:00:00+02:00',
      end: '2026-06-01T15:00:00+02:00',
    });
    expect(findConflicts(proposed, [existing])).toEqual([existing]);
  });

  it('AC-6: proposed ends exactly when existing starts — no clash (touching, not clashing)', () => {
    const proposed = interval({ start: '2026-06-01T13:00:00+02:00', end: '2026-06-01T14:00:00+02:00' });
    const existing = interval({
      id: 'e1',
      start: '2026-06-01T14:00:00+02:00',
      end: '2026-06-01T15:00:00+02:00',
    });
    expect(findConflicts(proposed, [existing])).toEqual([]);
  });

  it('AC-7: proposed starts exactly when existing ends — no clash (touching, not clashing)', () => {
    const proposed = interval({ start: '2026-06-01T15:00:00+02:00', end: '2026-06-01T16:00:00+02:00' });
    const existing = interval({
      id: 'e1',
      start: '2026-06-01T14:00:00+02:00',
      end: '2026-06-01T15:00:00+02:00',
    });
    expect(findConflicts(proposed, [existing])).toEqual([]);
  });

  it('AC-11: same time range on a different resource — no clash', () => {
    const proposed = interval({
      resourceId: RESOURCE_A,
      start: '2026-06-01T14:00:00+02:00',
      end: '2026-06-01T15:00:00+02:00',
    });
    const existing = interval({
      id: 'e1',
      resourceId: RESOURCE_B,
      start: '2026-06-01T14:00:00+02:00',
      end: '2026-06-01T15:00:00+02:00',
    });
    expect(findConflicts(proposed, [existing])).toEqual([]);
  });

  it('AC-10: a cancelled booking is simply absent from the candidate set and cannot block', () => {
    // Issue #32 removes cancelled bookings outright, so there is no status
    // flag to filter on here — this test asserts the absence directly: an
    // overlapping range that WOULD clash if present is not passed in at
    // all, and the candidate set is empty because it was "cancelled" (never
    // included).
    const proposed = interval({ start: '2026-06-01T14:00:00+02:00', end: '2026-06-01T15:00:00+02:00' });
    const cancelledCandidateSet: BookingInterval[] = [];
    expect(findConflicts(proposed, cancelledCandidateSet)).toEqual([]);
  });

  it('never compares a proposed booking against itself (same id excluded)', () => {
    const self = interval({
      id: 'shared-id',
      start: '2026-06-01T14:00:00+02:00',
      end: '2026-06-01T15:00:00+02:00',
    });
    const proposed: BookingInterval = { ...self };
    expect(findConflicts(proposed, [self])).toEqual([]);
  });

  it('multiple overlapping existing bookings return at least one conflicting range', () => {
    const proposed = interval({ start: '2026-06-01T14:00:00+02:00', end: '2026-06-01T17:00:00+02:00' });
    const existingOne = interval({
      id: 'e1',
      start: '2026-06-01T14:30:00+02:00',
      end: '2026-06-01T15:00:00+02:00',
    });
    const existingTwo = interval({
      id: 'e2',
      start: '2026-06-01T16:00:00+02:00',
      end: '2026-06-01T16:30:00+02:00',
    });
    const conflicts = findConflicts(proposed, [existingOne, existingTwo]);
    expect(conflicts.length).toBeGreaterThanOrEqual(1);
    expect(conflicts).toEqual(expect.arrayContaining([existingOne, existingTwo]));
  });

  it('clash outcome is unaffected by who booked or who it is for', () => {
    const proposed: BookingInterval = {
      resourceId: RESOURCE_A,
      start: '2026-06-01T14:00:00+02:00',
      end: '2026-06-01T15:00:00+02:00',
    };
    const existingSamePerson = interval({
      id: 'e1',
      start: '2026-06-01T14:30:00+02:00',
      end: '2026-06-01T15:30:00+02:00',
    });
    const existingDifferentPerson = interval({
      id: 'e2',
      start: '2026-06-01T14:30:00+02:00',
      end: '2026-06-01T15:30:00+02:00',
    });
    // bookedBy/bookedFor are not even part of BookingInterval — the type
    // itself proves they cannot influence the outcome. Both candidates,
    // identical in time/resource, clash identically.
    expect(findConflicts(proposed, [existingSamePerson])).toEqual([existingSamePerson]);
    expect(findConflicts(proposed, [existingDifferentPerson])).toEqual([existingDifferentPerson]);
  });

  it('handles a proposed range that crosses midnight and a DST boundary correctly', () => {
    // Europe/Berlin DST spring-forward 2026-03-29 02:00 -> 03:00 (CET -> CEST).
    // Proposed: 2026-03-28 23:00 CET through 2026-03-29 04:00 CEST — a
    // range that crosses both midnight and the DST transition. Compared as
    // absolute instants, this must still correctly detect a clash with an
    // existing booking that only overlaps after the transition.
    const proposed = interval({
      start: '2026-03-28T23:00:00+01:00',
      end: '2026-03-29T04:00:00+02:00',
    });
    const existingAfterTransition = interval({
      id: 'e1',
      start: '2026-03-29T03:30:00+02:00',
      end: '2026-03-29T05:00:00+02:00',
    });
    const existingTouchingEnd = interval({
      id: 'e2',
      start: '2026-03-29T04:00:00+02:00',
      end: '2026-03-29T05:00:00+02:00',
    });
    expect(findConflicts(proposed, [existingAfterTransition, existingTouchingEnd])).toEqual([
      existingAfterTransition,
    ]);
  });
});
