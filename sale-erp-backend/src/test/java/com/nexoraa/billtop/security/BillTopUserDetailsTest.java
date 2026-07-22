package com.nexoraa.billtop.security;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class BillTopUserDetailsTest {

    @Test
    void staffUserOnlyHasAccessToAssignedBranches() {
        BillTopUserDetails staff = userDetails("Staff", List.of(10L, 20L));

        assertThat(staff.hasBranchAccess(10L)).isTrue();
        assertThat(staff.hasBranchAccess(20L)).isTrue();
        assertThat(staff.hasBranchAccess(30L)).isFalse();
    }

    @Test
    void adminHasImplicitAccessToAnyBranchRegardlessOfAssignment() {
        BillTopUserDetails admin = userDetails("Admin", List.of());

        assertThat(admin.hasBranchAccess(999L)).isTrue();
    }

    @Test
    void superAdminHasImplicitAccessToAnyBranch() {
        BillTopUserDetails superAdmin = userDetails("Super Admin", List.of());

        assertThat(superAdmin.hasBranchAccess(999L)).isTrue();
    }

    @Test
    void nullBranchIdIsNeverAccessible() {
        BillTopUserDetails admin = userDetails("Admin", List.of());

        assertThat(admin.hasBranchAccess(null)).isFalse();
    }

    private BillTopUserDetails userDetails(String role, List<Long> branchIds) {
        return new BillTopUserDetails(
                1L,
                100L,
                "Acme",
                null,
                "user1",
                "encoded-password",
                role,
                List.of(),
                branchIds,
                true,
                true
        );
    }
}
