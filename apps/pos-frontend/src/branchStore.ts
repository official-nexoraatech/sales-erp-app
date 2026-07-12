const BRANCH_ID_KEY = 'pos_branch_id';
const WAREHOUSE_ID_KEY = 'pos_warehouse_id';

export interface SelectedBranch {
  branchId: number;
  warehouseId: number;
}

// PG-051: plain localStorage, matching auth.ts's existing convention — pos-frontend has
// no Zustand/Redux (unlike web-frontend's branch.store.ts), so this one persisted value
// doesn't warrant introducing a state-management library.
export function getSelectedBranch(): SelectedBranch | null {
  const branchId = localStorage.getItem(BRANCH_ID_KEY);
  const warehouseId = localStorage.getItem(WAREHOUSE_ID_KEY);
  if (!branchId || !warehouseId) return null;
  return { branchId: Number(branchId), warehouseId: Number(warehouseId) };
}

export function setSelectedBranch(branchId: number, warehouseId: number): void {
  localStorage.setItem(BRANCH_ID_KEY, String(branchId));
  localStorage.setItem(WAREHOUSE_ID_KEY, String(warehouseId));
}

export function clearSelectedBranch(): void {
  localStorage.removeItem(BRANCH_ID_KEY);
  localStorage.removeItem(WAREHOUSE_ID_KEY);
}
