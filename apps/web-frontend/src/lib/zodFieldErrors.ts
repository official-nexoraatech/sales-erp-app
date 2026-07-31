import type { ZodError } from 'zod';

/** Flattens a ZodError into a `{ 'path.to.field': message }` map, keyed the same way the
 * transactional forms address their fields (header fields by name, line items by
 * `lines.<index>.<field>`) — first issue per path wins, matching how a form only needs one
 * message per field at a time. */
export function toFieldErrors(error: ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.');
    if (!(key in errors)) errors[key] = issue.message;
  }
  return errors;
}
