import {
  Button,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue,
} from 'react-aria-components';
import type { Key } from 'react-aria-components';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/** A named entity (person or resource) that can be filtered by id. */
export interface FilterableEntity {
  id: string;
  name: string;
}

export interface EntityFilterSelectProps<T extends FilterableEntity> {
  /** Visible + accessible label, e.g. "Booked by" or "Resource". */
  label: string;
  /** The entities available to filter by. */
  entities: T[];
  /** The selected entity's id, or `undefined` when the filter is unset. */
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  /** Disables the control while the entity list is still loading. */
  isDisabled?: boolean;
  /** The key used for the "no filter" option, e.g. `'__any__'`. */
  anyKey: string;
  /** The visible + accessible text for the "no filter" option, e.g. "Anyone" or "All resources". */
  anyLabel: string;
  /** Extra layout classes merged onto the field wrapper. */
  className?: string;
}

/**
 * Shared visual tokens for a select trigger, popover and option — taken
 * from the shadcn/ui `aria-nova` `Select` component's own class strings so
 * these controls match the rest of the design system, applied directly to
 * the underlying `react-aria-components` primitives.
 *
 * We compose the RAC primitives here rather than importing shadcn's
 * packaged `Select` component because that packaged component (aria-nova)
 * renders each popover as a modal `dialog` with a close button and exposes
 * a hidden `<select>` as a `combobox` in the accessibility tree — a
 * heavier mobile-style pattern that breaks this app's accessibility
 * contract (a plain button + listbox + options, no dialog, no combobox;
 * §6.4/AC-8, and the tests that assert exactly that). Using the audited
 * RAC primitives with shadcn's tokens keeps the visual layer without
 * changing the accessibility semantics — this stays one UI framework.
 */
export const selectTriggerClass =
  'flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none data-[focus-visible]:border-ring data-[focus-visible]:ring-3 data-[focus-visible]:ring-ring/50 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[invalid]:border-destructive data-[invalid]:ring-3 data-[invalid]:ring-destructive/20 dark:bg-input/30';

export const selectPopoverClass =
  'z-50 w-(--trigger-width) min-w-36 overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none';

export const selectItemClass =
  'relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none data-focused:bg-accent data-focused:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50';

/**
 * One filter control shared by the resource schedule (issue #27) and
 * today overview (issue #29) views — "booked by"/"booked for" (person)
 * and "resource" filters are all a single-select narrowing dimension
 * over the SAME underlying pattern, so this is the one place that
 * pattern is wired up.
 *
 * Built on `react-aria-components` `Select` (per this agent's own
 * constraint against hand-rolled listbox/combobox semantics), styled with
 * shadcn/ui design tokens: `Select` supplies the button/listbox/popover
 * wiring, keyboard navigation (arrow keys, type-ahead, Escape-to-close),
 * and the label/value ARIA associations as a matter of normal usage.
 * `Select` is inherently single-select, which is exactly what a resource
 * filter needs (§6.4: at most one resource selected at a time).
 *
 * Always includes a leading "no filter" option (`anyKey`/`anyLabel`) so
 * the filter can be returned to its unset state from the control itself,
 * not only via the page-level "Clear filters" button (AC-8).
 */
export function EntityFilterSelect<T extends FilterableEntity>({
  label,
  entities,
  value,
  onChange,
  isDisabled = false,
  anyKey,
  anyLabel,
  className,
}: EntityFilterSelectProps<T>) {
  const selectedKey: Key = value ?? anyKey;

  return (
    <Select
      className={cn('flex w-full flex-col gap-1.5', className)}
      selectedKey={selectedKey}
      isDisabled={isDisabled}
      onSelectionChange={(key) => {
        onChange(key === anyKey ? undefined : String(key));
      }}
    >
      <Label className="text-sm font-medium text-muted-foreground">{label}</Label>
      <Button className={selectTriggerClass}>
        <SelectValue className="flex-1 text-left data-[placeholder]:text-muted-foreground" />
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Button>
      <Popover className={selectPopoverClass}>
        <ListBox className="max-h-[inherit] overflow-y-auto outline-hidden">
          <ListBoxItem id={anyKey} textValue={anyLabel} className={selectItemClass}>
            {({ isSelected }) => (
              <>
                <span className="flex-1">{anyLabel}</span>
                {isSelected && (
                  <CheckIcon className="absolute right-2 size-4" aria-hidden="true" />
                )}
              </>
            )}
          </ListBoxItem>
          {entities.map((entity) => (
            <ListBoxItem
              key={entity.id}
              id={entity.id}
              textValue={entity.name}
              className={selectItemClass}
            >
              {({ isSelected }) => (
                <>
                  <span className="flex-1">{entity.name}</span>
                  {isSelected && (
                    <CheckIcon className="absolute right-2 size-4" aria-hidden="true" />
                  )}
                </>
              )}
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </Select>
  );
}
