import {
  Button,
  FieldError,
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
import {
  selectItemClass,
  selectPopoverClass,
  selectTriggerClass,
} from './EntityFilterSelect';

/** A named option (person or purpose) a form select field can offer. */
export interface SelectableOption {
  id: string;
  label: string;
}

export interface FormSelectFieldProps<T extends SelectableOption> {
  /** Visible + accessible label, e.g. "Booked for" or "Purpose". */
  label: string;
  /** The options available to choose from (already loaded). */
  options: T[];
  /** The selected option's id, or `null` when nothing is chosen yet. */
  selectedKey: string | null;
  onSelectionChange: (id: string | null) => void;
  onBlur: () => void;
  /** Marks the field as required to assistive technology (not visually only). */
  isRequired?: boolean;
  /** Disables the control while `options` is still loading. */
  isDisabled?: boolean;
  /** The server/client validation message for this field, if any. */
  errorMessage?: string;
  placeholder?: string;
  /** Extra layout classes merged onto the field wrapper. */
  className?: string;
}

/**
 * A required, single-select booking-form field ("booked for", "purpose") —
 * FS-02 §6.1/AC-1, issue #40.
 *
 * Built on the same `react-aria-components` `Select` primitive as
 * `EntityFilterSelect` (issues #27/#29), styled with the same shadcn/ui
 * design tokens: `Select` supplies the button/listbox/popover wiring, full
 * keyboard operability, and the label/required/invalid ARIA associations
 * as a matter of normal usage (this agent's own constraint against
 * hand-writing combobox/listbox semantics).
 *
 * Unlike `EntityFilterSelect`, this field is REQUIRED and carries no
 * "any"/"all" option — a booking form field always resolves to exactly
 * one chosen person/purpose, never an unset filter state — and it wires
 * `isInvalid` plus React Aria's own `FieldError` so a backend field error
 * (via `bookingErrors.ts#toFieldErrorMap` → React Hook Form's `setError`)
 * is rendered next to this exact input and programmatically associated
 * with it (`aria-describedby`, wired by `Select` itself). The
 * `FieldError`'s rendered text is wrapped in `role="alert"` so it is
 * announced the moment it appears, not just exposed to an on-demand
 * screen-reader query.
 */
export function FormSelectField<T extends SelectableOption>({
  label,
  options,
  selectedKey,
  onSelectionChange,
  onBlur,
  isRequired = false,
  isDisabled = false,
  errorMessage,
  placeholder,
  className,
}: FormSelectFieldProps<T>) {
  const isInvalid = errorMessage !== undefined;

  return (
    <Select
      className={cn('flex w-full flex-col gap-1.5', className)}
      selectedKey={(selectedKey as Key | null) ?? null}
      onSelectionChange={(key) => onSelectionChange(key === null ? null : String(key))}
      onBlur={onBlur}
      isDisabled={isDisabled}
      isRequired={isRequired}
      isInvalid={isInvalid}
      validationBehavior="aria"
      placeholder={placeholder}
    >
      <Label className="text-sm font-medium">{label}</Label>
      <Button className={selectTriggerClass}>
        <SelectValue className="flex-1 text-left data-[placeholder]:text-muted-foreground" />
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Button>
      <Popover className={selectPopoverClass}>
        <ListBox className="max-h-[inherit] overflow-y-auto outline-hidden">
          {options.map((option) => (
            <ListBoxItem
              key={option.id}
              id={option.id}
              textValue={option.label}
              className={selectItemClass}
            >
              {({ isSelected }) => (
                <>
                  <span className="flex-1">{option.label}</span>
                  {isSelected && (
                    <CheckIcon className="absolute right-2 size-4" aria-hidden="true" />
                  )}
                </>
              )}
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
      {isInvalid && (
        <div role="alert">
          <FieldError className="text-sm font-medium text-destructive">
            {errorMessage}
          </FieldError>
        </div>
      )}
    </Select>
  );
}
