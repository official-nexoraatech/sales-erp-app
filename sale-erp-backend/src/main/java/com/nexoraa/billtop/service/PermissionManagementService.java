package com.nexoraa.billtop.service;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.config.PermissionConfigProperties;
import com.nexoraa.billtop.dto.permission.AssignUserPermissionsRequestDto;
import com.nexoraa.billtop.dto.permission.PermissionResponseDto;
import com.nexoraa.billtop.dto.permission.PermissionSummaryResponseDto;
import com.nexoraa.billtop.entity.Permission;
import com.nexoraa.billtop.entity.RolePermissionMapping;
import com.nexoraa.billtop.entity.User;
import com.nexoraa.billtop.entity.UserPermissionMapping;
import com.nexoraa.billtop.entity.UserPermissionMappingId;
import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.exception.UnauthorizedException;
import com.nexoraa.billtop.repository.PermissionRepository;
import com.nexoraa.billtop.repository.RolePermissionMappingRepository;
import com.nexoraa.billtop.repository.UserPermissionMappingRepository;
import com.nexoraa.billtop.repository.UserRepository;
import com.nexoraa.billtop.security.BillTopUserDetails;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Service to manage and access permissions from YAML configuration and database.
 * 
 * This service provides access to:
 * 1. YAML-configured permissions (from permissions-config.yaml)
 * 2. Database-persisted permissions (from permissions table via Flyway migration)
 * 3. Permission assignments to roles (from role_permissions table)
 */
@Service
public class PermissionManagementService {

    private final PermissionConfigProperties permissionConfigProperties;
    private final PermissionRepository permissionRepository;
    private final UserRepository userRepository;
    private final UserPermissionMappingRepository userPermissionMappingRepository;
    private final RolePermissionMappingRepository rolePermissionMappingRepository;
    private final CurrentOrganizationService currentOrganizationService;

    public PermissionManagementService(
            PermissionConfigProperties permissionConfigProperties,
            PermissionRepository permissionRepository,
            UserRepository userRepository,
            UserPermissionMappingRepository userPermissionMappingRepository,
            RolePermissionMappingRepository rolePermissionMappingRepository,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.permissionConfigProperties = permissionConfigProperties;
        this.permissionRepository = permissionRepository;
        this.userRepository = userRepository;
        this.userPermissionMappingRepository = userPermissionMappingRepository;
        this.rolePermissionMappingRepository = rolePermissionMappingRepository;
        this.currentOrganizationService = currentOrganizationService;
    }

    /**
     * The calling user's own permissions (role + direct grants), grouped by
     * group name. An org Admin can only ever grant a staff member a permission
     * they hold themselves — this is what backs the non-admin "Users →
     * Permissions" picker, so a permission never appears there as grantable
     * until the Admin's own role/account already has it.
     */
    @Transactional(readOnly = true)
    public Map<String, List<PermissionSummaryResponseDto>> getAllDatabasePermissionsGroupedByName() {
        BillTopUserDetails userDetails = getCurrentUserDetails();
        Map<String, List<PermissionSummaryResponseDto>> groupedPermissions = new LinkedHashMap<>();
        getUserPermissionEntities(currentOrganizationService.getOrganizationId(), userDetails.userId())
                .forEach(permission -> groupedPermissions
                        .computeIfAbsent(permission.getGroupName(), groupName -> new java.util.ArrayList<>())
                        .add(toSummaryResponse(permission)));
        return groupedPermissions;
    }

    /**
     * The full assignable permission catalog (every active permission in the
     * system), grouped by group name — used only by the Super Admin's
     * platform-wide permission picker (AdminPermissionController), since a
     * Super Admin manages the entire catalog rather than delegating from
     * their own permission set.
     */
    @Transactional(readOnly = true)
    public Map<String, List<PermissionSummaryResponseDto>> getFullPermissionCatalogGroupedByName() {
        Map<String, List<PermissionSummaryResponseDto>> groupedPermissions = new LinkedHashMap<>();
        permissionRepository.findAllByStatusAndIsDeletedFalse(Status.ACTIVE)
                .stream()
                .sorted((left, right) -> {
                    int groupCompare = left.getGroupName().compareToIgnoreCase(right.getGroupName());
                    if (groupCompare != 0) {
                        return groupCompare;
                    }
                    return left.getName().compareToIgnoreCase(right.getName());
                })
                .forEach(permission -> groupedPermissions
                        .computeIfAbsent(permission.getGroupName(), groupName -> new java.util.ArrayList<>())
                        .add(toSummaryResponse(permission)));
        return groupedPermissions;
    }

    @Transactional(readOnly = true)
    public List<PermissionResponseDto> getCurrentUserPermissions() {
        BillTopUserDetails userDetails = getCurrentUserDetails();
        return getUserPermissions(userDetails.userId());
    }

    @Transactional(readOnly = true)
    public List<PermissionResponseDto> getUserPermissions(Long userId) {
        return getUserPermissionsForOrganization(currentOrganizationService.getOrganizationId(), userId);
    }

    @Transactional(readOnly = true)
    public List<PermissionResponseDto> getUserPermissionsForOrganization(Long organizationId, Long userId) {
        return getUserPermissionEntities(organizationId, userId)
                .stream()
                .map(this::toResponse)
                .toList();
    }

    private List<Permission> getUserPermissionEntities(Long organizationId, Long userId) {
        User user = userRepository.findByIdAndOrganizationIdAndStatusAndIsDeletedFalse(
                        userId,
                        organizationId,
                        Status.ACTIVE
                )
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.USER_NOT_FOUND, "USER_NOT_FOUND"));

        Map<Long, Permission> permissionsById = new LinkedHashMap<>();
        rolePermissionMappingRepository.findActivePermissionsByRoleId(user.getRole().getId())
                .stream()
                .map(RolePermissionMapping::getPermission)
                .forEach(permission -> permissionsById.putIfAbsent(permission.getId(), permission));

        userPermissionMappingRepository.findActivePermissionsByUserId(user.getId())
                .stream()
                .map(UserPermissionMapping::getPermission)
                .forEach(permission -> permissionsById.putIfAbsent(permission.getId(), permission));

        return permissionsById.values()
                .stream()
                .sorted((left, right) -> {
                    int groupCompare = left.getGroupName().compareToIgnoreCase(right.getGroupName());
                    if (groupCompare != 0) {
                        return groupCompare;
                    }
                    return left.getName().compareToIgnoreCase(right.getName());
                })
                .toList();
    }

    @Transactional
    public void assignPermissionsToUser(AssignUserPermissionsRequestDto request) {
        assignPermissionsToUserForOrganization(currentOrganizationService.getOrganizationId(), request);
    }

    @Transactional
    public void assignPermissionsToUserForOrganization(Long organizationId, AssignUserPermissionsRequestDto request) {
        User user = userRepository.findByIdAndOrganizationIdAndStatusAndIsDeletedFalse(
                        request.getUserId(),
                        organizationId,
                        Status.ACTIVE
                )
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.USER_NOT_FOUND, "USER_NOT_FOUND"));

        Set<Long> requestedPermissionIds = new HashSet<>(request.getPermissionIds());
        List<Permission> permissions = permissionRepository.findAllByIdInAndStatusAndIsDeletedFalse(
                requestedPermissionIds,
                Status.ACTIVE
        );
        if (permissions.size() != requestedPermissionIds.size()) {
            throw new BadRequestException(ErrorMessage.PERMISSION_NOT_FOUND, "PERMISSION_NOT_FOUND");
        }

        userPermissionMappingRepository.deleteByUserId(user.getId());
        List<UserPermissionMapping> mappingsToSave = permissions.stream()
                .map(permission -> UserPermissionMapping.builder()
                        .id(new UserPermissionMappingId(user.getId(), permission.getId()))
                        .user(user)
                        .permission(permission)
                        .build())
                .toList();

        userPermissionMappingRepository.saveAll(mappingsToSave);
    }

    /**
     * Get all permissions by group name
     * 
     * @param groupName The group name (e.g., "item", "brand")
     * @return List of permissions in that group
     */
    public List<PermissionConfigProperties.Permission> getPermissionsByGroup(String groupName) {
        return permissionConfigProperties.getPermissionsByGroup(groupName);
    }

    /**
     * Get all permission groups
     * 
     * @return List of all permission group names
     */
    public List<String> getAllPermissionGroups() {
        return permissionConfigProperties.getAllGroups();
    }

    /**
     * Get all permissions across all groups
     * 
     * @return Map of group names to list of permissions
     */
    public Map<String, List<PermissionConfigProperties.Permission>> getAllPermissions() {
        Map<String, List<PermissionConfigProperties.Permission>> allPermissions = new HashMap<>();
        for (String group : getAllPermissionGroups()) {
            allPermissions.put(group, getPermissionsByGroup(group));
        }
        return allPermissions;
    }

    /**
     * Get permission count for a group
     * 
     * @param groupName The group name
     * @return Number of permissions in the group
     */
    public int getPermissionCountByGroup(String groupName) {
        return getPermissionsByGroup(groupName).size();
    }

    /**
     * Get total permission count across all groups
     * 
     * @return Total number of permissions
     */
    public int getTotalPermissionCount() {
        int total = 0;
        for (String group : getAllPermissionGroups()) {
            total += getPermissionCountByGroup(group);
        }
        return total;
    }

    /**
     * Check if a permission exists in a group
     * 
     * @param groupName The group name
     * @param permissionName The permission name
     * @return true if permission exists, false otherwise
     */
    public boolean permissionExists(String groupName, String permissionName) {
        return getPermissionsByGroup(groupName)
                .stream()
                .anyMatch(p -> p.getName().equals(permissionName));
    }

    /**
     * Get permission details by name
     * 
     * @param permissionName The permission name to search for
     * @return Permission object if found, null otherwise
     */
    public PermissionConfigProperties.Permission getPermissionByName(String permissionName) {
        for (String group : getAllPermissionGroups()) {
            for (PermissionConfigProperties.Permission permission : getPermissionsByGroup(group)) {
                if (permission.getName().equals(permissionName)) {
                    return permission;
                }
            }
        }
        return null;
    }

    /**
     * Get all permissions for an endpoint
     * 
     * @param endpoint The API endpoint
     * @return List of permissions for that endpoint
     */
    public List<PermissionConfigProperties.Permission> getPermissionsByEndpoint(String endpoint) {
        return getAllPermissions()
                .values()
                .stream()
                .flatMap(List::stream)
                .filter(p -> p.getEndpoint() != null && p.getEndpoint().contains(endpoint))
                .toList();
    }

    /**
     * Get permission configuration as formatted string for logging/debugging
     * 
     * @return Formatted string of all permissions
     */
    public String getPermissionSummary() {
        StringBuilder summary = new StringBuilder();
        summary.append("Permission Configuration Summary:\n");
        summary.append("================================\n");
        
        for (String group : getAllPermissionGroups()) {
            List<PermissionConfigProperties.Permission> permissions = getPermissionsByGroup(group);
            summary.append(String.format("\n%s (%d permissions):\n", group, permissions.size()));
            for (PermissionConfigProperties.Permission permission : permissions) {
                summary.append(String.format("  - %s: %s\n", permission.getName(), permission.getDescription()));
            }
        }
        
        summary.append(String.format("\nTotal Groups: %d\n", getAllPermissionGroups().size()));
        summary.append(String.format("Total Permissions: %d\n", getTotalPermissionCount()));
        
        return summary.toString();
    }

    private PermissionResponseDto toResponse(Permission permission) {
        return PermissionResponseDto.builder()
                .id(permission.getId())
                .groupName(permission.getGroupName())
                .name(permission.getName())
                .description(permission.getDescription())
                .endpoint(permission.getEndpoint())
                .status(permission.getStatus())
                .build();
    }

    private PermissionSummaryResponseDto toSummaryResponse(Permission permission) {
        return PermissionSummaryResponseDto.builder()
                .id(permission.getId())
                .name(permission.getName())
                .description(permission.getDescription())
                .build();
    }

    private BillTopUserDetails getCurrentUserDetails() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof BillTopUserDetails userDetails)) {
            throw new UnauthorizedException(ErrorMessage.UNAUTHORIZED, "USER_CONTEXT_MISSING");
        }
        return userDetails;
    }
}
