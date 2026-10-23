/**
 * Purpose category configuration (FS-02 FR-1, R-3).
 *
 * The set of valid booking purposes is application configuration, not
 * user-managed data: creating or editing purposes is out of scope (issue
 * #32). It is defined once, here, and is readable by later ticket work —
 * the `GET /api/purposes` route (#34) and the booking validity rule R-3
 * ("the purpose is one of the predefined categories configured for the
 * application", issue #33) both import from this module rather than
 * duplicating the list.
 *
 * This is deliberately a plain TypeScript constant rather than a database
 * table: the category set does not change without a deploy, so it needs no
 * migration and no runtime write path.
 */
export const PURPOSE_CATEGORIES = [
  'Meeting',
  'Focus work',
  'Interview',
  'Training',
  'Maintenance',
  'Other',
] as const;

export type Purpose = (typeof PURPOSE_CATEGORIES)[number];

/** True when `value` is one of the configured purpose categories. */
export function isValidPurpose(value: string): value is Purpose {
  return (PURPOSE_CATEGORIES as readonly string[]).includes(value);
}
