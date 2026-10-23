import type { Resource } from '../lib';
import { EntityFilterSelect } from './EntityFilterSelect';

/** Sentinel key for the "no filter"/"all resources" option in {@link ResourceFilterSelect}. */
export const ANY_RESOURCE_KEY = '__any__';

export interface ResourceFilterSelectProps {
  /** Visible + accessible label, e.g. "Resource". */
  label: string;
  /** The resources available to filter by (from `GET /api/resources`). */
  resources: Resource[];
  /** The selected resource's id, or `undefined` when the filter is unset ("all"). */
  value: string | undefined;
  onChange: (resourceId: string | undefined) => void;
  /** Disables the control while the resource list is still loading. */
  isDisabled?: boolean;
}

/**
 * The resource filter on the today overview (FS-01 FR-3/§6.4, issue #29).
 *
 * A thin wrapper around the same generic {@link EntityFilterSelect} that
 * `PersonFilterSelect` wraps (issue #27) — the underlying `Select`/
 * `ListBox`/`Popover` wiring is written once and shared, not duplicated.
 * `Select` is inherently single-select, so at most one resource can ever
 * be chosen at a time (§6.4) without any extra guarding logic here.
 */
export function ResourceFilterSelect({
  label,
  resources,
  value,
  onChange,
  isDisabled = false,
}: ResourceFilterSelectProps) {
  return (
    <EntityFilterSelect
      label={label}
      entities={resources}
      value={value}
      onChange={onChange}
      isDisabled={isDisabled}
      anyKey={ANY_RESOURCE_KEY}
      anyLabel="All resources"
    />
  );
}
