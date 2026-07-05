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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Super Admin API (v2) for managing roles across the platform. Organization-scoped
 * endpoints identify the organization explicitly via {organizationId} rather than
 * the caller's token; the flat listing endpoint applies an organization filter
 * only when one is supplied, otherwise it spans every organization.
 */
@Validated
@RestController
@RequestMapping("/api/v2/admin")
@PreAuthorize("hasAuthority('SUPER_ADMIN')")
public class AdminRoleController {

    private final RoleService roleService;

    public AdminRoleController(RoleService roleService) {
        this.roleService = roleService;
    }

    @GetMapping("/roles")
    public ResponseEntity<ApiResponseDto<List<RoleResponseDto>>> getRoles(
            @RequestParam(required = false) @Positive Long organizationId,
            @RequestParam(required = false) String search
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.ROLES_RETRIEVED,
                roleService.getRolesForAdmin(organizationId, search)
        ));
    }

    @PostMapping("/organizations/{organizationId}/roles")
    public ResponseEntity<ApiResponseDto<Void>> createRole(
            @PathVariable @Positive Long organizationId,
            @Valid @RequestBody RoleRequestDto request
    ) {
        roleService.createRoleForOrganization(organizationId, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.ROLE_CREATED));
    }

    @GetMapping("/organizations/{organizationId}/roles")
    public ResponseEntity<ApiResponseDto<List<RoleResponseDto>>> getRolesByOrganization(
            @PathVariable @Positive Long organizationId
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.ROLES_RETRIEVED,
                roleService.getRolesByOrganizationId(organizationId)
        ));
    }

    @GetMapping("/organizations/{organizationId}/roles/{id}")
    public ResponseEntity<ApiResponseDto<RoleResponseDto>> getRoleById(
            @PathVariable @Positive Long organizationId,
            @PathVariable @Positive Long id
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.ROLE_RETRIEVED,
                roleService.getRoleByIdForOrganization(organizationId, id)
        ));
    }

    @PutMapping("/organizations/{organizationId}/roles/{id}")
    public ResponseEntity<ApiResponseDto<Void>> updateRole(
            @PathVariable @Positive Long organizationId,
            @PathVariable @Positive Long id,
            @Valid @RequestBody RoleRequestDto request
    ) {
        roleService.updateRoleForOrganization(organizationId, id, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.ROLE_UPDATED));
    }

    @DeleteMapping("/organizations/{organizationId}/roles/{id}")
    public ResponseEntity<ApiResponseDto<Void>> deleteRole(
            @PathVariable @Positive Long organizationId,
            @PathVariable @Positive Long id
    ) {
        roleService.deleteRoleForOrganization(organizationId, id);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.ROLE_DELETED));
    }
}
