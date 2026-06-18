package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.common.FileUploadResponseDto;
import com.nexoraa.billtop.dto.organization.OrganizationRequestDto;
import com.nexoraa.billtop.dto.organization.OrganizationResponseDto;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

public interface OrganizationService {

    void createOrganization(OrganizationRequestDto request);

    List<OrganizationResponseDto> getOrganizations(String search);

    OrganizationResponseDto getOrganizationById(Long id);

    void updateOrganization(Long id, OrganizationRequestDto request);

    FileUploadResponseDto uploadOrganizationLogo(Long id, MultipartFile file);

    void deleteOrganization(Long id);
}
