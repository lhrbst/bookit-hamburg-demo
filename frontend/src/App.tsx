import { useRef } from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  ResourceListRoute,
  ResourceScheduleRoute,
  TodayOverviewRoute,
  BookingFormRoute,
  BookingConfirmationRoute,
  BookingDetailRoute,
} from './routes';
import { useFocusHeadingOnNavigate } from './hooks/useFocusHeadingOnNavigate';

/**
 * App shell — Task 2.1 (issue #23), FS-01 §6 UI Specification.
 *
 * Route structure:
 *
 *   - `/`                                          → redirects to `/resources`
 *   - `/resources`                                 → resource list (FS-01 §6.1)
 *   - `/resources/:resourceId/schedule/:date`       → resource schedule (§6.2),
 *     with BOTH the resource and the day as path segments (not just a
 *     query param) so the full view is a shareable/bookmarkable URL and
 *     later tickets (#24 date utils, #26 schedule view, #27 filters) have
 *     a stable place to read/write the day.
 *   - `/today`                                      → today overview (§6.3),
 *     reachable directly from the nav below, without selecting a resource
 *     first (FR-4).
 *   - `/resources/:resourceId/book`                 → booking form
 *     (FS-02 §6.1, issue #39), carrying the selected resource as a path
 *     segment, matching the schedule route's convention above. Wiring an
 *     actual "book this slot" entry point from the schedule/today
 *     overview views is issue #44 — this route just needs to resolve.
 *   - `/bookings/:id/confirmation`                   → booking
 *     confirmation (FS-02 §6.1, issue #39/#42).
 *   - `/bookings/:id`                                → booking detail
 *     (FS-02 §6.3, issue #39/#41), also the target of the confirmation
 *     screen's "view this booking" link.
 *
 * The nav is a real `<nav>` with `<Link>`/`<NavLink>` elements (not
 * `<a href>` or JS-only navigation), so it is keyboard-operable and shows
 * up correctly in the accessibility tree — this is user-facing chrome
 * that ships with this ticket, so Core Rule 1 (accessibility) applies to
 * it even though the three routes themselves are placeholder content.
 *
 * ## Post-navigation focus management (issue #45, Task 4.1)
 *
 * `useFocusHeadingOnNavigate` moves focus to the newly routed page's
 * `<h1>` on every client-side navigation after the first — see that
 * hook's own doc comment for why this is needed at all (React Router
 * does not do it) and how it works. `<main>`'s ref is what the hook
 * searches for a heading in, since every route element renders directly
 * inside it.
 */
function App() {
  const mainRef = useRef<HTMLElement>(null);
  useFocusHeadingOnNavigate(mainRef);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <nav
          aria-label="Main"
          className="mx-auto flex max-w-3xl items-center gap-1 px-4 py-3"
        >
          <span className="mr-2 font-heading text-base font-semibold">Bookit</span>
          <ul className="flex items-center gap-1">
            <li>
              <NavLink
                to="/resources"
                className={({ isActive }) =>
                  cn(
                    'inline-flex h-8 items-center rounded-lg px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                    isActive
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )
                }
              >
                Resources
              </NavLink>
            </li>
            <li>
              <NavLink
                to="/today"
                className={({ isActive }) =>
                  cn(
                    'inline-flex h-8 items-center rounded-lg px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                    isActive
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )
                }
              >
                Today&apos;s bookings
              </NavLink>
            </li>
          </ul>
        </nav>
      </header>

      <main ref={mainRef} className="mx-auto max-w-3xl px-4 py-6">
        <Alert role="note" className="mb-4">
          <AlertTitle>Public demo</AlertTitle>
          <AlertDescription>
            Synthetic data only. Everyone acts as the same demo person and can change shared bookings.
            Do not enter personal or confidential information.
          </AlertDescription>
        </Alert>
        <Routes>
          <Route path="/" element={<Navigate to="/resources" replace />} />
          <Route path="/resources" element={<ResourceListRoute />} />
          <Route
            path="/resources/:resourceId/schedule/:date"
            element={<ResourceScheduleRoute />}
          />
          <Route path="/today" element={<TodayOverviewRoute />} />
          <Route path="/resources/:resourceId/book" element={<BookingFormRoute />} />
          <Route path="/bookings/:id/confirmation" element={<BookingConfirmationRoute />} />
          <Route path="/bookings/:id" element={<BookingDetailRoute />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
