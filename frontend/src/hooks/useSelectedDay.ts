import { useCallback, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { addDays, isValidDayKey, todayInBerlin } from '../lib';

export interface UseSelectedDayResult {
  /** The Europe/Berlin `YYYY-MM-DD` day currently in view. Always valid. */
  selectedDay: string;
  /** Navigates to the calendar day immediately before {@link selectedDay}. */
  previousDay: () => void;
  /** Navigates to the calendar day immediately after {@link selectedDay}. */
  nextDay: () => void;
  /** Navigates to today's Europe/Berlin calendar day. */
  goToToday: () => void;
}

/**
 * Reads/writes the selected schedule day for the
 * `/resources/:resourceId/schedule/:date` route (issue #23's URL shape),
 * so the day is held as view state that defaults to today and is
 * reflected in the URL — making the schedule shareable and reloadable
 * (FS-01 FR-2, issue #24 AC).
 *
 * If the `:date` segment is missing or not a well-formed calendar day
 * (`isValidDayKey`), this redirects (`replace`, so it doesn't grow the
 * history stack) to the canonical URL for today, rather than silently
 * falling back to today in memory while the URL still shows something
 * else/nothing — the URL must always agree with what's on screen.
 */
export function useSelectedDay(): UseSelectedDayResult {
  const { resourceId, date } = useParams<{ resourceId: string; date?: string }>();
  const navigate = useNavigate();

  const requestedDayIsValid = date !== undefined && isValidDayKey(date);
  const selectedDay = requestedDayIsValid ? (date as string) : todayInBerlin();

  const navigateToDay = useCallback(
    (day: string) => {
      if (resourceId === undefined) {
        return;
      }
      navigate(`/resources/${resourceId}/schedule/${day}`, { replace: false });
    },
    [navigate, resourceId],
  );

  // Reflect a missing/invalid `:date` segment as a real redirect to
  // today's canonical URL, so a shared/reloaded link always shows the day
  // the view is actually rendering.
  useEffect(() => {
    if (!requestedDayIsValid && resourceId !== undefined) {
      navigate(`/resources/${resourceId}/schedule/${selectedDay}`, { replace: true });
    }
    // Only re-run when the inputs that decide the redirect target change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedDayIsValid, resourceId, selectedDay]);

  return {
    selectedDay,
    previousDay: () => navigateToDay(addDays(selectedDay, -1)),
    nextDay: () => navigateToDay(addDays(selectedDay, 1)),
    goToToday: () => navigateToDay(todayInBerlin()),
  };
}
