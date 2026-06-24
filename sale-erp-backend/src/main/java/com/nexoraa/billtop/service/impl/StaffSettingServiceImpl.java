package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.staff.StaffSettingRequestDto;
import com.nexoraa.billtop.dto.staff.StaffSettingResponseDto;
import com.nexoraa.billtop.entity.Organization;
import com.nexoraa.billtop.entity.StaffSetting;
import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.repository.StaffSettingRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.StaffSettingService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.util.List;
import java.util.Set;

@Service
public class StaffSettingServiceImpl implements StaffSettingService {

    private static final Set<String> ALLOWED_TYPES = Set.of(
            "departments",
            "designations",
            "shifts",
            "holidays",
            "leaveTypes",
            "salaryComponents"
    );

    private final StaffSettingRepository settingRepository;
    private final CurrentOrganizationService currentOrganizationService;

    public StaffSettingServiceImpl(
            StaffSettingRepository settingRepository,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.settingRepository = settingRepository;
        this.currentOrganizationService = currentOrganizationService;
    }

    @Override
    @Transactional(readOnly = true)
    public List<StaffSettingResponseDto> getSettings(String type) {
        String validatedType = validateType(type);
        return settingRepository.findByTypeAndOrganizationIdAndIsDeletedFalseOrderByNameAsc(
                        validatedType,
                        currentOrganizationService.getOrganizationId()
                )
                .stream()
                .map(this::toResponse)
                .toList();
    }

    @Override
    @Transactional
    public void createSetting(String type, StaffSettingRequestDto request) {
        String validatedType = validateType(type);
        Organization organization = currentOrganizationService.getOrganizationReference();
        Long organizationId = organization.getId();
        if (settingRepository.existsByTypeAndNameIgnoreCaseAndOrganizationIdAndIsDeletedFalse(
                validatedType,
                request.getName(),
                organizationId
        )) {
            throw new BadRequestException(ErrorMessage.STAFF_SETTING_ALREADY_EXISTS, "STAFF_SETTING_ALREADY_EXISTS");
        }

        StaffSetting setting = StaffSetting.builder()
                .organization(organization)
                .type(validatedType)
                .name(request.getName())
                .description(request.getDescription())
                .status(request.getStatus())
                .build();
        settingRepository.save(setting);
    }

    @Override
    @Transactional
    public void updateSetting(String type, Long id, StaffSettingRequestDto request) {
        String validatedType = validateType(type);
        Long organizationId = currentOrganizationService.getOrganizationId();
        StaffSetting setting = getSetting(validatedType, id);
        if (settingRepository.existsByTypeAndNameIgnoreCaseAndIdNotAndOrganizationIdAndIsDeletedFalse(
                validatedType,
                request.getName(),
                id,
                organizationId
        )) {
            throw new BadRequestException(ErrorMessage.STAFF_SETTING_ALREADY_EXISTS, "STAFF_SETTING_ALREADY_EXISTS");
        }
        setting.setName(request.getName());
        setting.setDescription(request.getDescription());
        setting.setStatus(request.getStatus());
        settingRepository.save(setting);
    }

    @Override
    @Transactional
    public void deleteSetting(String type, Long id) {
        StaffSetting setting = getSetting(validateType(type), id);
        setting.setStatus(Status.INACTIVE);
        setting.setIsDeleted(true);
        settingRepository.save(setting);
    }

    private StaffSetting getSetting(String type, Long id) {
        return settingRepository.findByIdAndTypeAndOrganizationIdAndIsDeletedFalse(
                        id,
                        type,
                        currentOrganizationService.getOrganizationId()
                )
                .orElseThrow(() -> new ResourceNotFoundException(
                        ErrorMessage.STAFF_SETTING_NOT_FOUND,
                        "STAFF_SETTING_NOT_FOUND"
                ));
    }

    private String validateType(String type) {
        if (!StringUtils.hasText(type) || !ALLOWED_TYPES.contains(type.trim())) {
            throw new BadRequestException(ErrorMessage.INVALID_STAFF_SETTING_TYPE, "INVALID_STAFF_SETTING_TYPE");
        }
        return type.trim();
    }

    private StaffSettingResponseDto toResponse(StaffSetting setting) {
        return StaffSettingResponseDto.builder()
                .id(setting.getId())
                .name(setting.getName())
                .description(setting.getDescription())
                .status(setting.getStatus())
                .build();
    }
}
