package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.common.IdResponseDto;
import com.nexoraa.billtop.dto.unit.UnitRequestDto;
import com.nexoraa.billtop.dto.unit.UnitResponseDto;
import com.nexoraa.billtop.entity.Unit;
import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.mapper.UnitMapper;
import com.nexoraa.billtop.repository.UnitRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.UnitService;
import com.nexoraa.billtop.specification.MasterDataSpecification;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class UnitServiceImpl implements UnitService {

    private final UnitRepository unitRepository;
    private final UnitMapper unitMapper;
    private final CurrentOrganizationService currentOrganizationService;

    public UnitServiceImpl(
            UnitRepository unitRepository,
            UnitMapper unitMapper,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.unitRepository = unitRepository;
        this.unitMapper = unitMapper;
        this.currentOrganizationService = currentOrganizationService;
    }

    @Override
    @Transactional
    public IdResponseDto createUnit(UnitRequestDto request) {
        Long organizationId = currentOrganizationService.getOrganizationId();
        if (unitRepository.existsByNameIgnoreCaseAndOrganizationIdAndStatusAndIsDeletedFalse(
                request.getName(),
                organizationId,
                Status.ACTIVE
        )) {
            throw new BadRequestException(ErrorMessage.UNIT_ALREADY_EXISTS, "UNIT_ALREADY_EXISTS");
        }
        Unit unit = unitMapper.toEntity(request);
        unit.setOrganization(currentOrganizationService.getOrganizationReference());
        unit = unitRepository.save(unit);
        return IdResponseDto.builder().id(unit.getId()).build();
    }

    @Override
    @Transactional(readOnly = true)
    public List<UnitResponseDto> getUnits(String search) {
        Specification<Unit> specification = MasterDataSpecification.<Unit>active()
                .and(MasterDataSpecification.organization(currentOrganizationService.getOrganizationId()))
                .and((root, query, criteriaBuilder) -> criteriaBuilder.isFalse(root.get("isDeleted")))
                .and(MasterDataSpecification.search(search, "name", "shortName"));
        return unitRepository.findAll(specification, Sort.by(Sort.Direction.ASC, "name"))
                .stream()
                .map(unitMapper::toResponse)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public UnitResponseDto getUnitById(Long id) {
        return unitMapper.toResponse(getActiveUnit(id));
    }

    @Override
    @Transactional
    public void updateUnit(Long id, UnitRequestDto request) {
        Unit unit = getActiveUnit(id);
        Long organizationId = currentOrganizationService.getOrganizationId();
        if (unitRepository.existsByNameIgnoreCaseAndIdNotAndOrganizationIdAndStatusAndIsDeletedFalse(
                request.getName(),
                id,
                organizationId,
                Status.ACTIVE
        )) {
            throw new BadRequestException(ErrorMessage.UNIT_ALREADY_EXISTS, "UNIT_ALREADY_EXISTS");
        }
        unitMapper.updateEntity(request, unit);
        unitRepository.save(unit);
    }

    @Override
    @Transactional
    public void deleteUnit(Long id) {
        Unit unit = getActiveUnit(id);
        unit.setStatus(Status.INACTIVE);
        unit.setIsDeleted(true);
        unitRepository.save(unit);
    }

    private Unit getActiveUnit(Long id) {
        return unitRepository.findByIdAndOrganizationIdAndStatusAndIsDeletedFalse(
                        id,
                        currentOrganizationService.getOrganizationId(),
                        Status.ACTIVE
                )
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.UNIT_NOT_FOUND, "UNIT_NOT_FOUND"));
    }
}



