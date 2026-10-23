import { useEffect, useRef, type RefObject } from 'react';
import { matchPath, useLocation, useNavigationType } from 'react-router-dom';

/**
 * The same path patterns `App`'s `<Routes>` registers. Duplicated here
 * (rather than imported) only because `App.tsx` declares them inline as
 * JSX `<Route path="...">` props, not as a shared array — matching this
 * list against the SAME literal strings keeps it trivially reviewable,
 * and it changes exactly as often as the route table itself does.
 */
const ROUTE_PATTERNS = [
  '/',
  '/resources',
  '/resources/:resourceId/schedule/:date',
  '/today',
  '/resources/:resourceId/book',
  '/bookings/:id/confirmation',
  '/bookings/:id',
];

/** The route pattern (e.g. `/bookings/:id`) matching `pathname`, or the
 * raw pathname itself if none match (defensive fallback only — every real
 * in-app pathname matches one of the patterns above). */
function matchedRoutePattern(pathname: string): string {
  for (const pattern of ROUTE_PATTERNS) {
    if (matchPath(pattern, pathname) !== null) {
      return pattern;
    }
  }
  return pathname;
}

/**
 * Moves keyboard/screen-reader focus to the new page's `<h1>` after a
 * client-side route change — issue #45 (Task 4.1, FS-02 §9/AC-12).
 *
 * ## The gap this closes
 *
 * React Router does NOT do this automatically: a `navigate(...)` call
 * (e.g. `BookingFormRoute`'s successful submit → `/bookings/:id/confirmation`,
 * or the schedule's "Book this free slot" link → `/resources/:id/book`)
 * swaps the rendered route content in place, but the BROWSER's focus
 * stays exactly where it was — on a button/link that has just been
 * unmounted. A keyboard or screen-reader user is left with focus on a
 * vanished element (or silently reset to `<body>`, which announces
 * nothing about where they landed). This is one of the most common SPA
 * accessibility defects, and every full-page navigation moved through
 * this exact flow (Task 4.1's audit scope), so it needs a single, shared
 * fix rather than a per-route one.
 *
 * ## The fix
 *
 * The common, documented pattern for SPA route announcements (see the
 * WAI-ARIA Authoring Practices' guidance on managing focus for
 * client-rendered navigation, and the same approach used by
 * `@reach/router`/Gatsby): on every navigation *after* the first render,
 * find the new page's `<h1>` inside the routed `<main>`, make it
 * programmatically focusable (`tabindex="-1"`, removed again once focus
 * leaves it so it never lingers in the accessibility tree or the tab
 * order), and focus it. Focusing the heading:
 *
 *  - Moves the user's screen-reader cursor there, so the heading text is
 *    announced — telling them where they landed, not just resetting
 *    focus to nowhere.
 *  - Does NOT add the heading to the natural Tab order (a `tabindex="-1"`
 *    element is programmatically focusable but is skipped by subsequent
 *    Tab presses), so this cannot be mistaken for a new interactive
 *    control.
 *  - Every route in this app already renders exactly one `<h1>` as its
 *    first heading (`ResourceListRoute`, `ResourceScheduleRoute`,
 *    `TodayOverviewRoute`, `BookingFormRoute`, `BookingConfirmationRoute`,
 *    `BookingDetailRoute`) — no route needs to change to satisfy this;
 *    the mechanism is purely additive.
 *
 * The very first render is skipped deliberately: focusing anything on
 * initial page load would steal focus from the browser chrome/URL bar
 * a user may have just been using, which is not this fix's job.
 *
 * ## Why this keys off the matched ROUTE PATTERN, not the raw pathname
 *
 * `ResourceScheduleRoute` (issue #24/#31) already has its own,
 * deliberately DIFFERENT accessible-navigation design for its "Previous
 * day"/"Today"/"Next day" buttons: changing only the `:date` path segment
 * does not remount that route's component, and its `<h1>` carries
 * `aria-live="polite"` specifically so the day change is announced
 * *without* moving focus away from the day-navigation button the user is
 * repeatedly pressing (see that route's own doc comment). Keying this
 * hook off `location.pathname`/`location.key` directly would refocus the
 * heading on every single day-navigation press and silently regress that
 * already-audited design — the user would be knocked back to the top of
 * the page and have to tab down to "Next day" again each time.
 *
 * Matching the current pathname against the same route patterns `App`
 * registers, and re-focusing only when that MATCHED PATTERN changes
 * (e.g. `/resources` → `/resources/:resourceId/schedule/:date`, or
 * `/resources/:resourceId/book` → `/bookings/:id/confirmation` →
 * `/bookings/:id`), targets exactly the case this ticket is about — a
 * genuine transition to a different screen — without touching the
 * same-route param changes `ResourceScheduleRoute` already handles its
 * own, different way.
 *
 * ## Why a `REPLACE` navigation is also excluded
 *
 * `App`'s `/` route is `<Navigate to="/resources" replace />` — every
 * fresh visit to the app's root bootstraps through this redirect
 * immediately on mount, before the user has done anything at all. That
 * redirect changes the matched route pattern (`/` → `/resources`) exactly
 * like a real navigation would, but it is not one from the user's point
 * of view — it is the app settling into its real starting URL. Stealing
 * focus onto the heading at that moment would UNDO the established
 * "first Tab reaches the main nav's 'Resources' link" convention (issue
 * #23/#31) on every fresh load. `useNavigationType()` reports `'REPLACE'`
 * for exactly this kind of redirect (and for `useSelectedDay`'s own
 * `replace: true` day-correction, which never changes the matched
 * pattern anyway and so would be a no-op here regardless) — skipping it
 * leaves initial app bootstrap alone while still catching every
 * user-driven `navigate(...)` (`PUSH`) and browser back/forward (`POP`)
 * transition between two different screens.
 *
 * ## Why "has the pattern actually changed" is tracked with a ref
 * comparison, not a one-shot "is this the first render" flag
 *
 * `main.tsx` renders the app inside `<StrictMode>`, which — in
 * development only — intentionally mounts, effect-cleans-up, and
 * re-mounts every component once, to surface exactly this class of bug.
 * A plain "have I run once yet" boolean flag flips to `false` on that
 * FIRST simulated pass and stays `false` for the immediate real second
 * pass with the SAME dependency values — wrongly treating React's own
 * double-invocation as a second, real navigation and stealing focus onto
 * the heading the instant the app loads. Comparing the current matched
 * pattern against a ref holding the LAST PATTERN THIS EFFECT ACTUALLY
 * SAW is idempotent under that double-invocation instead: both
 * StrictMode passes see the identical pattern (nothing navigated
 * between them), so the comparison correctly finds "unchanged" both
 * times, regardless of how many times React chooses to invoke the
 * effect for the same committed dependency values.
 */
export function useFocusHeadingOnNavigate(containerRef: RefObject<HTMLElement>): void {
  const location = useLocation();
  const navigationType = useNavigationType();
  const routePattern = matchedRoutePattern(location.pathname);
  const previousRoutePattern = useRef(routePattern);

  useEffect(() => {
    const hasPatternChanged = previousRoutePattern.current !== routePattern;
    previousRoutePattern.current = routePattern;

    if (!hasPatternChanged) {
      return;
    }

    if (navigationType === 'REPLACE') {
      // Initial-bootstrap redirect (`/` → `/resources`) or a same-pattern
      // param correction — never a user-facing screen transition. See
      // this hook's own doc comment for why this is excluded.
      return;
    }

    const container = containerRef.current;
    if (container === null) {
      return;
    }

    const heading = container.querySelector('h1');
    if (!(heading instanceof HTMLElement)) {
      return;
    }

    const hadTabIndex = heading.hasAttribute('tabindex');
    if (!hadTabIndex) {
      heading.setAttribute('tabindex', '-1');
    }
    heading.focus();

    function removeTemporaryTabIndex() {
      if (!hadTabIndex) {
        heading?.removeAttribute('tabindex');
      }
    }

    heading.addEventListener('blur', removeTemporaryTabIndex, { once: true });
    return () => {
      heading.removeEventListener('blur', removeTemporaryTabIndex);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires purely on the matched route pattern/navigation type changing, not container identity
  }, [routePattern, navigationType]);
}
