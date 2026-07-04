package com.nexoraa.billtop.controller.admin;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.permission.AssignUserPermissionsRequestDto;
import com.nexoraa.billtop.dto.permission.PermissionResponseDto;
import com.nexoraa.billtop.service.PermissionManagementService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Positive;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Super Admin API (v2) for viewing and assigning permissions to a user inside
 * a specific organization, identified explicitly by {organizationId}/{userId}
 * rather than the caller's own token/organization.
 */
@Validated
@RestController
@RequestMapping("/api/v2/admin/organizations/{organizationId}/users/{userId}/permissions")
@PreAuthorize("hasAuthority('SUPER_ADMIN')")
public class AdminPermissionController {

    private final PermissionManagementService permissionManagementService;

    public AdminPermissionController(PermissionManagementService permissionManagementService) {
        this.permissionManagementService = permissionManagementService;
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<List<PermissionResponseDto>>> getUserPermissions(
            @PathVariable @Positive Long organizationId,
            @PathVariable @Positive Long userId
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.USER_PERMISSIONS_RETRIEVED,
                permissionManagementService.getUserPermissionsForOrganization(organizationId, userId)
        ));
    }

    @PostMapping
    public ResponseEntity<ApiResponseDto<Void>> assignPermissionsToUser(
            @PathVariable @Positive Long organizationId,
            @PathVariable @Positive Long userId,
            @Valid @RequestBody AssignUserPermissionsRequestDto request
    ) {
        request.setUserId(userId);
        permissionManagementService.assignPermissionsToUserForOrganization(organizationId, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.USER_PERMISSIONS_ASSIGNED));
    }
}
