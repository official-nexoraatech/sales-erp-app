import { useBranchStore } from '../store/branchStore';

export const useBranch = () => {
  const { selectedBranchId, setSelectedBranchId, clearSelectedBranch } = useBranchStore();

  return {
    selectedBranchId,
    setSelectedBranchId,
    clearSelectedBranch,
  };
};
