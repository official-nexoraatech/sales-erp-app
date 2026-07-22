package com.nexoraa.billtop.security;

import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

public record BillTopUserDetails(
        Long userId,
        Long organizationId,
        String organizationName,
        String organizationLogoUrl,
        String username,
        String password,
        String role,
        List<String> permissions,
        List<Long> branchIds,
        boolean enabled,
        boolean organizationSubscribed
) implements UserDetails {

    private static final String SUPER_ADMIN_ROLE_NAME = "Super Admin";
    private static final String ADMIN_ROLE_NAME = "Admin";
    public static final String SUPER_ADMIN_AUTHORITY = "SUPER_ADMIN";

    public boolean isSuperAdmin() {
        return role != null && role.trim().equalsIgnoreCase(SUPER_ADMIN_ROLE_NAME);
    }

    public boolean isAdmin() {
        return role != null && role.trim().equalsIgnoreCase(ADMIN_ROLE_NAME);
    }

    /**
     * Org-level admins implicitly manage every branch in their organization;
     * regular staff are restricted to the branches they're explicitly mapped to.
     */
    public boolean hasBranchAccess(Long branchId) {
        if (branchId == null) {
            return false;
        }
        if (isSuperAdmin() || isAdmin()) {
            return true;
        }
        return branchIds != null && branchIds.contains(branchId);
    }

    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        List<GrantedAuthority> authorities = new ArrayList<>(permissions.stream()
                .map(SimpleGrantedAuthority::new)
                .toList());
        if (isSuperAdmin()) {
            authorities.add(new SimpleGrantedAuthority(SUPER_ADMIN_AUTHORITY));
        }
        return authorities;
    }

    @Override
    public String getPassword() {
        return password;
    }

    @Override
    public String getUsername() {
        return username;
    }

    @Override
    public boolean isAccountNonExpired() {
        return true;
    }

    @Override
    public boolean isAccountNonLocked() {
        return enabled;
    }

    @Override
    public boolean isCredentialsNonExpired() {
        return true;
    }
}
