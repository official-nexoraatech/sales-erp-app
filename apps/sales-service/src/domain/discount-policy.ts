// Users can discount up to this without approval; anything higher requires a user whose role
// carries DISCOUNT_OVERRIDE (SALES_MANAGER/ADMIN/OWNER by default) — reuses the existing RBAC
// permission rather than a new PIN/approval subsystem. Was POS-only (pos.routes.ts); H-5 fix
// extends the same ceiling to back-office Invoice/Quotation creation, which had no cap at all.
export const MAX_CASHIER_DISCOUNT_PCT = 10;
