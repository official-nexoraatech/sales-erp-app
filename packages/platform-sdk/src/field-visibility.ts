// CRM-ROADMAP Phase 3, Feature 6 (Field-level RBAC for CRM Records). Extends this codebase's
// existing route-level/page-level RBAC with response-shaping depth: a field is omitted, not
// nulled, for a caller lacking the permission that guards it — omission is safer than null,
// since null can be mistaken for "no value" rather than "no access."

function omit<T extends object>(obj: T, fields: (keyof T)[]): T {
  const filtered = { ...obj };
  for (const field of fields) delete filtered[field];
  return filtered;
}

/** Removes `fields` from `obj` unless the caller holds `permission`. Omits, never nulls. */
export function omitFieldsWithoutPermission<T extends object>(
  obj: T,
  fields: (keyof T)[],
  permissions: string[],
  permission: string
): T {
  return permissions.includes(permission) ? obj : omit(obj, fields);
}

/** Same as {@link omitFieldsWithoutPermission}, applied to every row in a list. */
export function omitFieldsFromListWithoutPermission<T extends object>(
  rows: T[],
  fields: (keyof T)[],
  permissions: string[],
  permission: string
): T[] {
  return permissions.includes(permission) ? rows : rows.map((row) => omit(row, fields));
}
