package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.config.PermissionConfigProperties;
import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.permission.AssignUserPermissionsRequestDto;
import com.nexoraa.billtop.dto.permission.PermissionResponseDto;
import com.nexoraa.billtop.dto.permission.PermissionSummaryResponseDto;
import com.nexoraa.billtop.service.PermissionManagementService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * Controller to manage and retrieve permission information.
 * This controller exposes endpoints for retrieving permission configuration
 * from both YAML configuration and the database.
 */
@RestController
@RequestMapping("/api/v1/permissions")
public class PermissionController {

    private final PermissionManagementService permissionManagementService;

    public PermissionController(PermissionManagementService permissionManagementService) {
        this.permissionManagementService = permissionManagementService;
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<Map<String, List<PermissionSummaryResponseDto>>>> getAllDatabasePermissions() {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.PERMISSIONS_RETRIEVED,
                permissionManagementService.getAllDatabasePermissionsGroupedByName()
        ));
    }

    @GetMapping("/users/me")
    public ResponseEntity<ApiResponseDto<List<PermissionResponseDto>>> getCurrentUserPermissions() {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.USER_PERMISSIONS_RETRIEVED,
                permissionManagementService.getCurrentUserPermissions()
        ));
    }

    @PostMapping("/users/assign")
    public ResponseEntity<ApiResponseDto<Void>> assignPermissionsToUser(
            @Valid @RequestBody AssignUserPermissionsRequestDto request
    ) {
        permissionManagementService.assignPermissionsToUser(request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.USER_PERMISSIONS_ASSIGNED));
    }

    /**
     * Get all permission groups
     * 
     * @return List of permission group names
     */
    @GetMapping("/groups")
    public ResponseEntity<ApiResponseDto<List<String>>> getAllGroups() {
        List<String> groups = permissionManagementService.getAllPermissionGroups();
        return ResponseEntity.ok(ApiResponseDto.success("Permission groups retrieved successfully", groups));
    }

    /**
     * Get all permissions across all groups
     * 
     * @return Map of group names to list of permissions
     */
    @GetMapping("/all")
    public ResponseEntity<ApiResponseDto<Map<String, List<PermissionConfigProperties.Permission>>>> getAllPermissions() {
        Map<String, List<PermissionConfigProperties.Permission>> permissions = permissionManagementService.getAllPermissions();
        return ResponseEntity.ok(ApiResponseDto.success("All permissions retrieved successfully", permissions));
    }

    /**
     * Get permissions by group name
     * 
     * @param groupName The group name
     * @return List of permissions in the group
     */
    @GetMapping("/group/{groupName}")
    public ResponseEntity<ApiResponseDto<List<PermissionConfigProperties.Permission>>> getPermissionsByGroup(
            @PathVariable String groupName) {
        List<PermissionConfigProperties.Permission> permissions = permissionManagementService.getPermissionsByGroup(groupName);
        return ResponseEntity.ok(ApiResponseDto.success(
                String.format("Permissions for group '%s' retrieved successfully", groupName),
                permissions
        ));
    }

    /**
     * Get permission by name
     * 
     * @param permissionName The permission name
     * @return Permission details
     */
    @GetMapping("/{permissionName}")
    public ResponseEntity<ApiResponseDto<PermissionConfigProperties.Permission>> getPermissionByName(
            @PathVariable String permissionName) {
        PermissionConfigProperties.Permission permission = permissionManagementService.getPermissionByName(permissionName);
        if (permission != null) {
            return ResponseEntity.ok(ApiResponseDto.success("Permission retrieved successfully", permission));
        }
        return ResponseEntity.notFound().build();
    }

    /**
     * Get permission statistics
     * 
     * @return Map containing permission statistics
     */
    @GetMapping("/stats/summary")
    public ResponseEntity<ApiResponseDto<Map<String, Object>>> getPermissionStatistics() {
        Map<String, Object> stats = Map.of(
                "totalPermissions", permissionManagementService.getTotalPermissionCount(),
                "totalGroups", permissionManagementService.getAllPermissionGroups().size(),
                "groups", permissionManagementService.getAllPermissionGroups()
        );
        return ResponseEntity.ok(ApiResponseDto.success("Permission statistics retrieved successfully", stats));
    }

    /**
     * Get permission count for a specific group
     * 
     * @param groupName The group name
     * @return Count of permissions in the group
     */
    @GetMapping("/group/{groupName}/count")
    public ResponseEntity<ApiResponseDto<Map<String, Integer>>> getGroupPermissionCount(
            @PathVariable String groupName) {
        int count = permissionManagementService.getPermissionCountByGroup(groupName);
        Map<String, Integer> result = Map.of("groupName", 1, "permissionCount", count);
        return ResponseEntity.ok(ApiResponseDto.success(
                String.format("Permission count for group '%s' retrieved successfully", groupName),
                result
        ));
    }
}
