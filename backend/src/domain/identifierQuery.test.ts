import { describe, expect, it } from 'vitest';
import { ValidationError } from './errors';
import { parseBookingQuery } from './bookingQuery';
import { parseScheduleQuery } from './scheduleQuery';

const postgresUuid = '22222222-2222-2222-2222-222222222221';

describe('query identifier validation', () => {
  it('accepts PostgreSQL UUIDs that do not use RFC version and variant bits', () => {
    const bookings = parseBookingQuery({
      resourceId: postgresUuid,
      bookedById: postgresUuid,
      bookedForId: postgresUuid,
    });
    const schedule = parseScheduleQuery({
      bookedById: postgresUuid,
      bookedForId: postgresUuid,
    });

    expect(bookings.resourceId).toBe(postgresUuid);
    expect(bookings.bookedById).toBe(postgresUuid);
    expect(bookings.bookedForId).toBe(postgresUuid);
    expect(schedule.bookedById).toBe(postgresUuid);
    expect(schedule.bookedForId).toBe(postgresUuid);
  });

  it('continues to reject malformed identifiers', () => {
    expect(() => parseBookingQuery({ resourceId: 'not-a-uuid' })).toThrow(ValidationError);
    expect(() => parseScheduleQuery({ bookedById: 'not-a-uuid' })).toThrow(ValidationError);
  });
});
