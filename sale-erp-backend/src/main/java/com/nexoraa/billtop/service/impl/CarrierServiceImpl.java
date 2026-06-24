package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.carrier.CarrierRequestDto;
import com.nexoraa.billtop.dto.carrier.CarrierResponseDto;
import com.nexoraa.billtop.entity.Organization;
import com.nexoraa.billtop.entity.ShippingCarrier;
import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.mapper.CarrierMapper;
import com.nexoraa.billtop.repository.ShippingCarrierRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.CarrierService;
import com.nexoraa.billtop.specification.MasterDataSpecification;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CarrierServiceImpl implements CarrierService {

    private final ShippingCarrierRepository shippingCarrierRepository;
    private final CarrierMapper carrierMapper;
    private final CurrentOrganizationService currentOrganizationService;

    public CarrierServiceImpl(
            ShippingCarrierRepository shippingCarrierRepository,
            CarrierMapper carrierMapper,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.shippingCarrierRepository = shippingCarrierRepository;
        this.carrierMapper = carrierMapper;
        this.currentOrganizationService = currentOrganizationService;
    }

    @Override
    @Transactional
    public void createCarrier(CarrierRequestDto request) {
        Organization organization = currentOrganizationService.getOrganizationReference();
        Long organizationId = organization.getId();
        if (shippingCarrierRepository.existsByNameIgnoreCaseAndOrganizationIdAndStatusAndIsDeletedFalse(
                request.getName(),
                organizationId,
                Status.ACTIVE
        )) {
            throw new BadRequestException(ErrorMessage.CARRIER_ALREADY_EXISTS, "CARRIER_ALREADY_EXISTS");
        }
        ShippingCarrier carrier = carrierMapper.toEntity(request);
        carrier.setOrganization(organization);
        shippingCarrierRepository.save(carrier);
    }

    @Override
    @Transactional(readOnly = true)
    public PageResponseDto<CarrierResponseDto> getCarriers(int page, int size, String search) {
        Specification<ShippingCarrier> specification = MasterDataSpecification.<ShippingCarrier>active()
                .and(MasterDataSpecification.organization(currentOrganizationService.getOrganizationId()))
                .and((root, query, criteriaBuilder) -> criteriaBuilder.isFalse(root.get("isDeleted")))
                .and(MasterDataSpecification.search(search, "name", "email", "mobile", "whatsappNo", "address", "note"));
        return PageResponseDto.from(shippingCarrierRepository
                .findAll(specification, PageRequest.of(page, size, Sort.by(Sort.Direction.ASC, "name")))
                .map(carrierMapper::toResponse));
    }

    @Override
    @Transactional(readOnly = true)
    public CarrierResponseDto getCarrierById(Long id) {
        return carrierMapper.toResponse(getActiveCarrier(id));
    }

    @Override
    @Transactional
    public void updateCarrier(Long id, CarrierRequestDto request) {
        ShippingCarrier carrier = getActiveCarrier(id);
        Long organizationId = currentOrganizationService.getOrganizationId();
        if (shippingCarrierRepository.existsByNameIgnoreCaseAndIdNotAndOrganizationIdAndStatusAndIsDeletedFalse(
                request.getName(),
                id,
                organizationId,
                Status.ACTIVE
        )) {
            throw new BadRequestException(ErrorMessage.CARRIER_ALREADY_EXISTS, "CARRIER_ALREADY_EXISTS");
        }
        carrierMapper.updateEntity(request, carrier);
        shippingCarrierRepository.save(carrier);
    }

    @Override
    @Transactional
    public void deleteCarrier(Long id) {
        ShippingCarrier carrier = getActiveCarrier(id);
        carrier.setStatus(Status.INACTIVE);
        carrier.setIsDeleted(true);
        shippingCarrierRepository.save(carrier);
    }

    private ShippingCarrier getActiveCarrier(Long id) {
        return shippingCarrierRepository.findByIdAndOrganizationIdAndStatusAndIsDeletedFalse(
                        id,
                        currentOrganizationService.getOrganizationId(),
                        Status.ACTIVE
                )
                .orElseThrow(() -> new ResourceNotFoundException(
                        ErrorMessage.SHIPPING_CARRIER_NOT_FOUND,
                        "SHIPPING_CARRIER_NOT_FOUND"
                ));
    }
}
