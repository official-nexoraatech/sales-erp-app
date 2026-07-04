package com.nexoraa.billtop.controller.admin;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.constants.ValidationMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.common.FileUploadResponseDto;
import com.nexoraa.billtop.dto.organization.OrganizationRequestDto;
import com.nexoraa.billtop.dto.organization.OrganizationResponseDto;
import com.nexoraa.billtop.dto.role.RoleRequestDto;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.service.OrganizationService;
import com.nexoraa.billtop.service.RoleService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Positive;
import org.springframework.http.MediaType;
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
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

/**
 * Super Admin API (v2) for onboarding and managing organizations across the platform.
 * Access is restricted to the "Super Admin" role via the SUPER_ADMIN authority.
 */
@Validated
@RestController
@RequestMapping("/api/v2/admin/organizations")
@PreAuthorize("hasAuthority('SUPER_ADMIN')")
public class AdminOrganizationController {

    private final OrganizationService organizationService;
    private final RoleService roleService;

    public AdminOrganizationController(OrganizationService organizationService, RoleService roleService) {
        this.organizationService = organizationService;
        this.roleService = roleService;
    }

    @PostMapping
    public ResponseEntity<ApiResponseDto<Void>> createOrganization(
            @Valid @RequestBody OrganizationRequestDto request
    ) {
        organizationService.createOrganization(request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.ORGANIZATION_CREATED));
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<List<OrganizationResponseDto>>> getOrganizations(
            @RequestParam(required = false) String search
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.ORGANIZATIONS_RETRIEVED,
                organizationService.getOrganizations(search)
        ));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponseDto<OrganizationResponseDto>> getOrganizationById(
            @PathVariable @Positive Long id
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.ORGANIZATION_RETRIEVED,
                organizationService.getOrganizationById(id)
        ));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> updateOrganization(
            @PathVariable @Positive Long id,
            @Valid @RequestBody OrganizationRequestDto request
    ) {
        organizationService.updateOrganization(id, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.ORGANIZATION_UPDATED));
    }

    @PostMapping(value = "/{id}/logo", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<ApiResponseDto<FileUploadResponseDto>> uploadOrganizationLogo(
            @PathVariable @Positive Long id,
            @RequestParam MultipartFile file
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.ORGANIZATION_LOGO_UPLOADED,
                organizationService.uploadOrganizationLogo(id, file)
        ));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> deleteOrganization(@PathVariable @Positive Long id) {
        organizationService.deleteOrganization(id);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.ORGANIZATION_DELETED));
    }

    @PostMapping("/roles")
    public ResponseEntity<ApiResponseDto<Void>> createRole(@Valid @RequestBody RoleRequestDto request) {
        if (request.getOrganizationId() == null) {
            throw new BadRequestException(ValidationMessage.ORGANIZATION_ID_REQUIRED, "ORGANIZATION_ID_REQUIRED");
        }
        roleService.createRoleForOrganization(request.getOrganizationId(), request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.ROLE_CREATED));
    }
}
