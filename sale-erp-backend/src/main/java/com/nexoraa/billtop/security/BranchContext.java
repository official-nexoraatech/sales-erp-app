package com.nexoraa.billtop.security;

/**
 * Holds the branch id validated by {@link BranchAuthorizationFilter} for the
 * lifetime of the current request thread.
 */
public final class BranchContext {

    private static final ThreadLocal<Long> CURRENT_BRANCH_ID = new ThreadLocal<>();

    private BranchContext() {
    }

    public static void setBranchId(Long branchId) {
        CURRENT_BRANCH_ID.set(branchId);
    }

    public static Long getBranchId() {
        return CURRENT_BRANCH_ID.get();
    }

    public static void clear() {
        CURRENT_BRANCH_ID.remove();
    }
}
