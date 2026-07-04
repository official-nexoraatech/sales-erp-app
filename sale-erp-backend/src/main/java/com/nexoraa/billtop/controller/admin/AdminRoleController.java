package com.nexoraa.billtop.controller.admin;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.role.RoleRequestDto;
import com.nexoraa.billtop.dto.role.RoleResponseDto;
import com.nexoraa.billtop.service.RoleService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Positive;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Super Admin API (v2) for managing roles inside a specific organization,
 * identified explicitly by {organizationId} rather than the caller's token.
 */
@Validated
@RestController
@RequestMapping("/api/v2/admin/organizations/{organizationId}/roles")
@PreAuthorize("hasAuthority('SUPER_ADMIN')")
public class AdminRoleController {

    private final RoleService roleService;

    public AdminRoleController(RoleService roleService) {
        this.roleService = roleService;
    }

    @PostMapping
    public ResponseEntity<ApiResponseDto<Void>> createRole(
            @PathVariable @Positive Long organizationId,
            @Valid @RequestBody RoleRequestDto request
    ) {
        roleService.createRoleForOrganization(organizationId, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.ROLE_CREATED));
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<List<RoleResponseDto>>> getRoles(
            @PathVariable @Positive Long organizationId
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.ROLES_RETRIEVED,
                roleService.getRolesByOrganizationId(organizationId)
        ));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponseDto<RoleResponseDto>> getRoleById(
            @PathVariable @Positive Long organizationId,
            @PathVariable @Positive Long id
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.ROLE_RETRIEVED,
                roleService.getRoleByIdForOrganization(organizationId, id)
        ));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> updateRole(
            @PathVariable @Positive Long organizationId,
            @PathVariable @Positive Long id,
            @Valid @RequestBody RoleRequestDto request
    ) {
        roleService.updateRoleForOrganization(organizationId, id, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.ROLE_UPDATED));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> deleteRole(
            @PathVariable @Positive Long organizationId,
            @PathVariable @Positive Long id
    ) {
        roleService.deleteRoleForOrganization(organizationId, id);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.ROLE_DELETED));
    }
}
