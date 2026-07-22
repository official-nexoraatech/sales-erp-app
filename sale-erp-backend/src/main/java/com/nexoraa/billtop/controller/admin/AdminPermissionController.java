package com.nexoraa.billtop.controller.admin;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.permission.AssignUserPermissionsRequestDto;
import com.nexoraa.billtop.dto.permission.PermissionResponseDto;
import com.nexoraa.billtop.dto.permission.PermissionSummaryResponseDto;
import com.nexoraa.billtop.service.PermissionManagementService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Positive;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * Super Admin API (v2) for the platform-wide permission catalog and for viewing
 * and assigning permissions to a user inside a specific organization, identified
 * explicitly by {organizationId}/{userId} rather than the caller's own token.
 */
@Validated
@RestController
@RequestMapping("/api/v2/admin")
@PreAuthorize("hasAuthority('SUPER_ADMIN')")
public class AdminPermissionController {

    private final PermissionManagementService permissionManagementService;

    public AdminPermissionController(PermissionManagementService permissionManagementService) {
        this.permissionManagementService = permissionManagementService;
    }

    @GetMapping("/permissions")
    public ResponseEntity<ApiResponseDto<Map<String, List<PermissionSummaryResponseDto>>>> getAllPermissions() {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.PERMISSIONS_RETRIEVED,
                permissionManagementService.getFullPermissionCatalogGroupedByName()
        ));
    }

    @GetMapping("/organizations/{organizationId}/users/{userId}/permissions")
    public ResponseEntity<ApiResponseDto<List<PermissionResponseDto>>> getUserPermissions(
            @PathVariable @Positive Long organizationId,
            @PathVariable @Positive Long userId
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.USER_PERMISSIONS_RETRIEVED,
                permissionManagementService.getUserPermissionsForOrganization(organizationId, userId)
        ));
    }

    @PostMapping("/organizations/{organizationId}/users/{userId}/permissions")
    public ResponseEntity<ApiResponseDto<Void>> assignPermissionsToUser(
            @PathVariable @Positive Long organizationId,
            @PathVariable @Positive Long userId,
            @Valid @RequestBody AssignUserPermissionsRequestDto request
    ) {
        request.setUserId(userId);
        permissionManagementService.assignPermissionsToUserForOrganization(organizationId, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.USER_PERMISSIONS_ASSIGNED));
    }

    @PutMapping("/organizations/{organizationId}/users/{userId}/permissions")
    public ResponseEntity<ApiResponseDto<Void>> updateUserPermissions(
            @PathVariable @Positive Long organizationId,
            @PathVariable @Positive Long userId,
            @Valid @RequestBody AssignUserPermissionsRequestDto request
    ) {
        request.setUserId(userId);
        permissionManagementService.assignPermissionsToUserForOrganization(organizationId, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.USER_PERMISSIONS_UPDATED));
    }
}
