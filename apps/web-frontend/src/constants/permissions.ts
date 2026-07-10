// PG-016: re-exported from the backend source of truth instead of a hand-mirrored
// copy, so renames/removals in shared-types are caught here at compile time.
export { PERMISSIONS, type Permission } from '@erp/types';
