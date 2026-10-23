import type { Person } from '../lib';
import { EntityFilterSelect } from './EntityFilterSelect';

/** Sentinel key for the "no filter"/"anyone" option in {@link PersonFilterSelect}. */
export const ANY_PERSON_KEY = '__any__';

export interface PersonFilterSelectProps {
  /** Visible + accessible label, e.g. "Booked by". */
  label: string;
  /** The people available to filter by (from `GET /api/people`). */
  people: Person[];
  /** The selected person's id, or `undefined` when the filter is unset ("any"). */
  value: string | undefined;
  onChange: (personId: string | undefined) => void;
  /** Disables the control while the people list is still loading. */
  isDisabled?: boolean;
}

/**
 * One "booked by"/"booked for" filter control on the resource schedule
 * (issue #27) and today overview (issue #29) views (FS-01 FR-3/§6.4).
 *
 * A thin wrapper around the generic {@link EntityFilterSelect} — kept as
 * its own named component (rather than inlining `EntityFilterSelect`
 * everywhere) so existing call sites and their accessible names/behaviour
 * are unaffected by the #29 generalisation.
 */
export function PersonFilterSelect({
  label,
  people,
  value,
  onChange,
  isDisabled = false,
}: PersonFilterSelectProps) {
  return (
    <EntityFilterSelect
      label={label}
      entities={people}
      value={value}
      onChange={onChange}
      isDisabled={isDisabled}
      anyKey={ANY_PERSON_KEY}
      anyLabel="Anyone"
    />
  );
}
