package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.role.RoleRequestDto;
import com.nexoraa.billtop.dto.role.RoleResponseDto;
import com.nexoraa.billtop.service.RoleService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Positive;
import org.springframework.http.ResponseEntity;
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

@Validated
@RestController
@RequestMapping("/api/v1/roles")
public class RoleController {

    private final RoleService roleService;

    public RoleController(RoleService roleService) {
        this.roleService = roleService;
    }

    @PostMapping
    public ResponseEntity<ApiResponseDto<Void>> createRole(@Valid @RequestBody RoleRequestDto request) {
        roleService.createRole(request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.ROLE_CREATED));
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<List<RoleResponseDto>>> getRoles(
            @RequestParam(required = false) String search
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.ROLES_RETRIEVED, roleService.getRoles(search)));
    }

    @GetMapping("/organization/{organizationId}")
    public ResponseEntity<ApiResponseDto<List<RoleResponseDto>>> getRolesByOrganizationId(
            @PathVariable @Positive Long organizationId
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.ROLES_RETRIEVED,
                roleService.getRolesByOrganizationId(organizationId)
        ));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponseDto<RoleResponseDto>> getRoleById(@PathVariable @Positive Long id) {
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.ROLE_RETRIEVED, roleService.getRoleById(id)));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> updateRole(
            @PathVariable @Positive Long id,
            @Valid @RequestBody RoleRequestDto request
    ) {
        roleService.updateRole(id, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.ROLE_UPDATED));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> deleteRole(@PathVariable @Positive Long id) {
        roleService.deleteRole(id);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.ROLE_DELETED));
    }
}
