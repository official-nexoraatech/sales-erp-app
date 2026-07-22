import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

interface BranchStore {
  selectedBranchId: number | null;
  setSelectedBranchId: (branchId: number) => void;
  clearSelectedBranch: () => void;
}

const useBranchStore = create<BranchStore>()(
  devtools(
    persist(
      (set) => ({
        selectedBranchId: null,

        setSelectedBranchId: (branchId: number) => {
          set({ selectedBranchId: branchId });
        },

        clearSelectedBranch: () => {
          set({ selectedBranchId: null });
        },
      }),
      {
        name: 'branch-storage',
        partialize: (state) => ({
          selectedBranchId: state.selectedBranchId,
        }),
      }
    )
  )
);

export { useBranchStore };
