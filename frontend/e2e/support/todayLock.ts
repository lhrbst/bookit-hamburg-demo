import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * A cross-process, cross-spec-file mutex over the shared live "today"
 * bucket (FS-01 FR-3/FR-4), used by `today-overview.spec.ts` and
 * `today-overview-filters.spec.ts`.
 *
 * `test.describe.configure({ mode: 'serial' })` inside a single spec file
 * only protects that file's OWN tests from racing each other — it does
 * nothing for two DIFFERENT spec files that each independently create
 * and assert against real bookings on the actual current Europe/Berlin
 * calendar day, which Playwright (by default, and in most real CI setups
 * that don't force `workers: 1`) runs concurrently in separate worker
 * processes. Two tests in different files/workers can otherwise:
 *  - book the SAME resource for genuinely overlapping times (a real
 *    409 clash, not a bug in either test), or
 *  - each assert an exact total count of "today"'s bookings while the
 *    other is mid-fixture-creation/cleanup.
 *
 * This lock uses `fs.mkdirSync` (atomic "create if absent" on every
 * platform this suite runs on) against a fixed path in the OS temp
 * directory, so it is visible to every worker process regardless of
 * which one holds it — an in-memory lock (e.g. a module-level boolean)
 * would only work within a single worker process and would not help
 * here, since different spec files can be assigned to different worker
 * processes.
 */
const LOCK_DIR = path.join(os.tmpdir(), 'bookit-e2e-today.lock');
/** A lock older than this is assumed abandoned (e.g. a crashed prior
 * run) and force-cleared rather than blocking forever. */
const STALE_AFTER_MS = 60_000;
const POLL_INTERVAL_MS = 50;
const ACQUIRE_TIMEOUT_MS = 30_000;

function tryAcquire(): boolean {
  try {
    fs.mkdirSync(LOCK_DIR);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
    try {
      const age = Date.now() - fs.statSync(LOCK_DIR).mtimeMs;
      if (age > STALE_AFTER_MS) {
        fs.rmSync(LOCK_DIR, { recursive: true, force: true });
      }
    } catch {
      // Another process may have removed it between our stat and rm —
      // fine, the next poll iteration will simply try to acquire again.
    }
    return false;
  }
}

/**
 * Runs `fn` while holding the exclusive "today" lock, waiting for any
 * other worker/spec file currently holding it to finish first. Always
 * releases the lock, even if `fn` throws — so a failing test never
 * leaves the whole suite deadlocked.
 */
export async function withTodayLock<T>(fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;
  while (!tryAcquire()) {
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out after ${ACQUIRE_TIMEOUT_MS}ms waiting for the shared "today" e2e lock (${LOCK_DIR}). ` +
          'Another worker may be stuck holding it — check for a crashed prior run.',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(LOCK_DIR, { recursive: true, force: true });
  }
}
