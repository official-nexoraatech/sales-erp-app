package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.common.FileUploadResponseDto;
import com.nexoraa.billtop.dto.organization.OrganizationRequestDto;
import com.nexoraa.billtop.dto.organization.OrganizationResponseDto;
import com.nexoraa.billtop.service.OrganizationService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Positive;
import org.springframework.http.MediaType;
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
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

@Validated
@RestController
@RequestMapping("/api/v1/organizations")
public class OrganizationController {

    private final OrganizationService organizationService;

    public OrganizationController(OrganizationService organizationService) {
        this.organizationService = organizationService;
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
}
