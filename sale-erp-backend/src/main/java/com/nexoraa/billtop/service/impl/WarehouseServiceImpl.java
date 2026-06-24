package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.common.IdResponseDto;
import com.nexoraa.billtop.dto.warehouse.WarehouseRequestDto;
import com.nexoraa.billtop.dto.warehouse.WarehouseResponseDto;
import com.nexoraa.billtop.entity.Organization;
import com.nexoraa.billtop.entity.Warehouse;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.mapper.WarehouseMapper;
import com.nexoraa.billtop.repository.WarehouseRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.WarehouseService;
import com.nexoraa.billtop.specification.MasterDataSpecification;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class WarehouseServiceImpl implements WarehouseService {

    private final WarehouseRepository warehouseRepository;
    private final WarehouseMapper warehouseMapper;
    private final CurrentOrganizationService currentOrganizationService;

    public WarehouseServiceImpl(
            WarehouseRepository warehouseRepository,
            WarehouseMapper warehouseMapper,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.warehouseRepository = warehouseRepository;
        this.warehouseMapper = warehouseMapper;
        this.currentOrganizationService = currentOrganizationService;
    }

    @Override
    @Transactional
    public IdResponseDto createWarehouse(WarehouseRequestDto request) {
        Organization organization = currentOrganizationService.getOrganizationReference();
        Long organizationId = organization.getId();
        if (warehouseRepository.existsByWarehouseCodeIgnoreCaseAndOrganizationIdAndStatus(
                request.getWarehouseCode(),
                organizationId,
        com.nexoraa.billtop.enums.Status.ACTIVE)) {
            throw new BadRequestException(ErrorMessage.WAREHOUSE_ALREADY_EXISTS, "WAREHOUSE_ALREADY_EXISTS");
        }
        Warehouse warehouse = warehouseMapper.toEntity(request);
        warehouse.setOrganization(organization);
        return IdResponseDto.builder().id(warehouseRepository.save(warehouse).getId()).build();
    }

    @Override
    @Transactional(readOnly = true)
    public List<WarehouseResponseDto> getWarehouses(String search) {
        Specification<Warehouse> specification = MasterDataSpecification.<Warehouse>active()
                .and(MasterDataSpecification.organization(currentOrganizationService.getOrganizationId()))
                .and(MasterDataSpecification.search(search, "name", "warehouseCode", "address"));
        return warehouseRepository.findAll(specification, Sort.by(Sort.Direction.ASC, "name"))
                .stream()
                .map(warehouseMapper::toResponse)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public WarehouseResponseDto getWarehouseById(Long id) {
        return warehouseMapper.toResponse(getActiveWarehouse(id));
    }

    @Override
    @Transactional
    public void updateWarehouse(Long id, WarehouseRequestDto request) {
        Warehouse warehouse = getActiveWarehouse(id);
        Long organizationId = currentOrganizationService.getOrganizationId();
        if (warehouseRepository.existsByWarehouseCodeIgnoreCaseAndIdNotAndOrganizationIdAndStatus(
                request.getWarehouseCode(),
                id,
                organizationId,
        com.nexoraa.billtop.enums.Status.ACTIVE)) {
            throw new BadRequestException(ErrorMessage.WAREHOUSE_ALREADY_EXISTS, "WAREHOUSE_ALREADY_EXISTS");
        }
        warehouseMapper.updateEntity(request, warehouse);
        warehouseRepository.save(warehouse);
    }

    @Override
    @Transactional
    public void deleteWarehouse(Long id) {
        Warehouse warehouse = getActiveWarehouse(id);
        warehouse.setStatus(com.nexoraa.billtop.enums.Status.INACTIVE);
        warehouseRepository.save(warehouse);
    }

    private Warehouse getActiveWarehouse(Long id) {
        return warehouseRepository.findByIdAndOrganizationIdAndStatus(
                        id,
                        currentOrganizationService.getOrganizationId(),
                com.nexoraa.billtop.enums.Status.ACTIVE)
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.WAREHOUSE_NOT_FOUND, "WAREHOUSE_NOT_FOUND"));
    }
}





