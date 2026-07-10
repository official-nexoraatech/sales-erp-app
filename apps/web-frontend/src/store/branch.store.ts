import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Per ERP-PLANNING/02_ERP_NAVIGATION_ARCHITECTURE.md §14: sets the *default* branch
 * that create-forms and branch-scoped UI pre-select. Does not filter list-page query
 * results — no list endpoint accepts a branch-narrowing param yet (see doc for why).
 */
interface BranchState {
  currentBranchId: number | null;
  setCurrentBranchId: (id: number) => void;
}

export const useBranchStore = create<BranchState>()(
  persist(
    (set) => ({
      currentBranchId: null,
      setCurrentBranchId: (id) => set({ currentBranchId: id }),
    }),
    { name: 'nexoraa-branch' },
  ),
);
