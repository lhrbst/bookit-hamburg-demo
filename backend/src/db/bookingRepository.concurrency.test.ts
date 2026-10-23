import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from './pool';
import { createBooking } from './bookingRepository';
import { ConflictError } from '../domain/errors';

/**
 * Integration test for issue #49 (FS-03 FR-5, §7 invariant, AC-14).
 *
 * Unlike every other `*.test.ts` file in this codebase, this one talks to
 * a REAL PostgreSQL instance through the real `pool` — it is not a pure
 * unit test. It exists to prove, under genuine concurrent load, the claim
 * that ADR-003 already makes structurally: the `booking_no_overlap`
 * exclusion constraint (`EXCLUDE USING GIST (resource_id WITH =, during
 * WITH &&)`) gives atomic, per-resource-scoped serialisation of
 * `createBooking` calls for free, with no application-level locking
 * needed and no read-then-insert race.
 *
 * ## Why this is an integration test, not a unit test
 *
 * The guarantee under test is a property of PostgreSQL's MVCC + GiST
 * index locking at commit time. It cannot be observed by calling a pure
 * function twice in Node — it requires two real, concurrently-committing
 * transactions racing against the same index. Mocking `pg` here would
 * only prove that our mock behaves the way we already assume; it would
 * not prove the constraint.
 *
 * ## Skip behaviour
 *
 * If no reachable PostgreSQL instance is configured (`DATABASE_URL`
 * unset/unreachable), this file skips itself gracefully rather than
 * failing hard — following the project's existing conventions of never
 * letting infra be a false negative for behaviour tests. There is no
 * established repo pattern for this yet (this is the first "needs a live
 * database" test in the codebase), so this establishes one: `beforeAll`
 * probes connectivity once with a plain `SELECT 1` and records the
 * result; each `it` checks that result first and calls vitest's `ctx.skip()`
 * if the database is unreachable, rather than letting every query in the
 * body throw and fail the suite. (`describe.skipIf`/`it.skipIf` need
 * their condition synchronously at collection time and this project's
 * `tsconfig` targets `commonjs`, which additionally forbids the top-level
 * `await` that would otherwise be needed to compute the condition, so
 * `ctx.skip()` inside each test is the correct mechanism here, not those
 * static skip helpers.)
 *
 * ## Isolation
 *
 * Every row this file creates (temporary `resource`/`person` rows, and
 * every `booking` row) is created and torn down by this file alone, using
 * ids distinguishable at a glance (`'concurrency-test-...'` names) so a
 * failed run is easy to spot and hand-clean if `afterAll` itself does not
 * run. `afterAll` deletes bookings by resource id first (satisfying the
 * `booking` -> `resource`/`person` foreign keys) and then the temporary
 * resource/person rows, leaving the shared database exactly as found.
 *
 * ## Confidence level of the repeated-iteration loop
 *
 * A race condition test can never be exhaustive: it can only demonstrate
 * that, across N real attempts under real scheduling variance, the
 * invariant held every time. It cannot prove the invariant holds for
 * attempt N+1, and a passing run is not a mathematical proof the way the
 * exclusion constraint's definition is. What it *does* provide is: (a)
 * confirmation the two `createBooking` calls are actually concurrent at
 * the network/connection-pool level (not serialised by, say, a single
 * shared client or an accidental `await` in sequence), and (b) empirical
 * confidence proportional to the number of iterations that no timing
 * window exists in which both inserts can commit. Running it 8 times with
 * fresh, non-conflicting slots between iterations is a reasonable but
 * not airtight bar for CI: enough to catch a *structural* regression
 * (e.g. someone "optimising" this into a check-then-write) with high
 * probability on every run, without making the suite flaky or slow.
 */

const TEMP_RESOURCE_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const TEMP_RESOURCE_B = 'aaaaaaaa-0000-4000-8000-000000000002';
const TEMP_PERSON = 'bbbbbbbb-0000-4000-8000-000000000001';

async function isDatabaseReachable(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a real database was reachable, decided once before any test
 * runs. `describe`/`it` bodies below are synchronous at collection time,
 * so this cannot be a top-level `await` (and this project's `tsconfig`
 * targets `commonjs`, which disallows one); instead `beforeAll` probes
 * the database and every test bails out early via `ctx.skip()` when it
 * is unreachable, which is vitest's supported way to skip based on an
 * async precondition.
 */
let dbReachable = true;

describe('createBooking concurrency (issue #49)', () => {
  beforeAll(async () => {
    dbReachable = await isDatabaseReachable();
    if (!dbReachable) {
      return;
    }
    await pool.query(
      `INSERT INTO resource (id, name, description, type) VALUES
         ($1, 'concurrency-test-resource-a', 'temp fixture for issue #49', 'room'),
         ($2, 'concurrency-test-resource-b', 'temp fixture for issue #49', 'room')`,
      [TEMP_RESOURCE_A, TEMP_RESOURCE_B],
    );
    await pool.query(
      `INSERT INTO person (id, name) VALUES ($1, 'concurrency-test-person')`,
      [TEMP_PERSON],
    );
  });

  afterAll(async () => {
    if (!dbReachable) {
      return;
    }
    await pool.query('DELETE FROM booking WHERE resource_id = ANY($1::uuid[])', [
      [TEMP_RESOURCE_A, TEMP_RESOURCE_B],
    ]);
    await pool.query('DELETE FROM resource WHERE id = ANY($1::uuid[])', [
      [TEMP_RESOURCE_A, TEMP_RESOURCE_B],
    ]);
    await pool.query('DELETE FROM person WHERE id = $1', [TEMP_PERSON]);
  });

  async function countBookingsInRange(
    resourceId: string,
    start: string,
    end: string,
  ): Promise<number> {
    const result = await pool.query<{ count: string }>(
      `SELECT count(*) AS count
         FROM booking
        WHERE resource_id = $1
          AND during && tstzrange($2, $3, '[)')`,
      [resourceId, start, end],
    );
    return Number(result.rows[0]!.count);
  }

  function makeInput(
    resourceId: string,
    start: string,
    end: string,
  ): Parameters<typeof createBooking>[0] {
    return {
      resourceId,
      bookedBy: TEMP_PERSON,
      bookedFor: TEMP_PERSON,
      purpose: 'Meeting',
      start,
      end,
    };
  }

  it('AC: exactly one of two overlapping concurrent creations on the same resource succeeds, the loser gets a clash ConflictError with a range, and the DB shows exactly one row — repeated across iterations for confidence', async (ctx) => {
    if (!dbReachable) {
      ctx.skip();
      return;
    }
    for (let i = 0; i < 8; i += 1) {
      // Fresh, mutually non-conflicting slot per iteration so earlier
      // iterations' surviving bookings cannot interfere with later ones.
      const day = 10 + i; // 2027-01-10, -11, -12, ...
      const start = `2027-01-${day}T09:00:00+01:00`;
      const overlappingStart = `2027-01-${day}T09:30:00+01:00`;
      const end = `2027-01-${day}T10:00:00+01:00`;
      const overlappingEnd = `2027-01-${day}T10:30:00+01:00`;

      const [a, b] = await Promise.allSettled([
        createBooking(makeInput(TEMP_RESOURCE_A, start, end)),
        createBooking(makeInput(TEMP_RESOURCE_A, overlappingStart, overlappingEnd)),
      ]);

      const fulfilled = [a, b].filter(
        (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof createBooking>>> =>
          r.status === 'fulfilled',
      );
      const rejected = [a, b].filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const loserReason = rejected[0]!.reason;
      expect(loserReason).toBeInstanceOf(ConflictError);
      const conflictError = loserReason as ConflictError;
      expect(conflictError.fieldErrors.length).toBeGreaterThan(0);
      expect(conflictError.fieldErrors.some((fe) => fe.conflict !== undefined)).toBe(true);

      // The database itself agrees: exactly one row exists spanning the
      // requested window on this resource — no orphan, no duplicate.
      const count = await countBookingsInRange(
        TEMP_RESOURCE_A,
        start,
        overlappingEnd,
      );
      expect(count).toBe(1);
    }
  }, 30_000);

  it('AC: concurrent back-to-back (touching) creations on the same resource both succeed', async (ctx) => {
    if (!dbReachable) {
      ctx.skip();
      return;
    }
    const start = '2027-02-01T09:00:00+01:00';
    const middle = '2027-02-01T10:00:00+01:00';
    const end = '2027-02-01T11:00:00+01:00';

    const [a, b] = await Promise.allSettled([
      createBooking(makeInput(TEMP_RESOURCE_A, start, middle)),
      createBooking(makeInput(TEMP_RESOURCE_A, middle, end)),
    ]);

    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('fulfilled');

    const count = await countBookingsInRange(TEMP_RESOURCE_A, start, end);
    expect(count).toBe(2);
  });

  it('AC: concurrent creations on DIFFERENT resources (same/overlapping time) both succeed and do not block each other', async (ctx) => {
    if (!dbReachable) {
      ctx.skip();
      return;
    }
    const start = '2027-03-01T09:00:00+01:00';
    const end = '2027-03-01T10:00:00+01:00';

    const [a, b] = await Promise.allSettled([
      createBooking(makeInput(TEMP_RESOURCE_A, start, end)),
      createBooking(makeInput(TEMP_RESOURCE_B, start, end)),
    ]);

    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('fulfilled');

    const countA = await countBookingsInRange(TEMP_RESOURCE_A, start, end);
    const countB = await countBookingsInRange(TEMP_RESOURCE_B, start, end);
    expect(countA).toBe(1);
    expect(countB).toBe(1);
  });
});
