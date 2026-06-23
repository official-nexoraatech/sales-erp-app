package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.common.IdResponseDto;
import com.nexoraa.billtop.dto.payment.PaymentMethodRequestDto;
import com.nexoraa.billtop.dto.payment.PaymentMethodResponseDto;
import com.nexoraa.billtop.entity.PaymentMethod;
import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.repository.PaymentMethodRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.PaymentMethodService;
import com.nexoraa.billtop.specification.MasterDataSpecification;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class PaymentMethodServiceImpl implements PaymentMethodService {

    private final PaymentMethodRepository paymentMethodRepository;
    private final CurrentOrganizationService currentOrganizationService;

    public PaymentMethodServiceImpl(
            PaymentMethodRepository paymentMethodRepository,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.paymentMethodRepository = paymentMethodRepository;
        this.currentOrganizationService = currentOrganizationService;
    }

    @Override
    @Transactional
    public IdResponseDto createPaymentMethod(PaymentMethodRequestDto request) {
        Long organizationId = currentOrganizationService.getOrganizationId();
        if (paymentMethodRepository.existsByNameIgnoreCaseAndOrganizationIdAndStatusAndIsDeletedFalse(
                request.getName(),
                organizationId,
                Status.ACTIVE
        )) {
            throw new BadRequestException(
                    ErrorMessage.PAYMENT_METHOD_ALREADY_EXISTS,
                    "PAYMENT_METHOD_ALREADY_EXISTS"
            );
        }

        PaymentMethod paymentMethod = PaymentMethod.builder()
                .organization(currentOrganizationService.getOrganizationReference())
                .name(request.getName())
                .description(request.getDescription())
                .status(request.getStatus() == null ? Status.ACTIVE : request.getStatus())
                .build();
        return IdResponseDto.builder().id(paymentMethodRepository.save(paymentMethod).getId()).build();
    }

    @Override
    @Transactional(readOnly = true)
    public List<PaymentMethodResponseDto> getPaymentMethods(String search) {
        Specification<PaymentMethod> specification = MasterDataSpecification.<PaymentMethod>active()
                .and(MasterDataSpecification.organization(currentOrganizationService.getOrganizationId()))
                .and((root, query, criteriaBuilder) -> criteriaBuilder.isFalse(root.get("isDeleted")))
                .and(MasterDataSpecification.search(search, "name", "description"));

        return paymentMethodRepository.findAll(specification, Sort.by(Sort.Direction.ASC, "name"))
                .stream()
                .map(this::toResponse)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public PaymentMethodResponseDto getPaymentMethodById(Long id) {
        return toResponse(getActivePaymentMethod(id));
    }

    @Override
    @Transactional
    public void updatePaymentMethod(Long id, PaymentMethodRequestDto request) {
        Long organizationId = currentOrganizationService.getOrganizationId();
        PaymentMethod paymentMethod = getActivePaymentMethod(id);
        if (paymentMethodRepository.existsByNameIgnoreCaseAndIdNotAndOrganizationIdAndStatusAndIsDeletedFalse(
                request.getName(),
                id,
                organizationId,
                Status.ACTIVE
        )) {
            throw new BadRequestException(
                    ErrorMessage.PAYMENT_METHOD_ALREADY_EXISTS,
                    "PAYMENT_METHOD_ALREADY_EXISTS"
            );
        }

        paymentMethod.setName(request.getName());
        paymentMethod.setDescription(request.getDescription());
        if (request.getStatus() != null) {
            paymentMethod.setStatus(request.getStatus());
        }
        paymentMethodRepository.save(paymentMethod);
    }

    @Override
    @Transactional
    public void deletePaymentMethod(Long id) {
        PaymentMethod paymentMethod = getActivePaymentMethod(id);
        paymentMethod.setStatus(Status.INACTIVE);
        paymentMethod.setIsDeleted(true);
        paymentMethodRepository.save(paymentMethod);
    }

    private PaymentMethod getActivePaymentMethod(Long id) {
        return paymentMethodRepository.findByIdAndOrganizationIdAndStatusAndIsDeletedFalse(
                        id,
                        currentOrganizationService.getOrganizationId(),
                        Status.ACTIVE
                )
                .orElseThrow(() -> new ResourceNotFoundException(
                        ErrorMessage.PAYMENT_METHOD_NOT_FOUND,
                        "PAYMENT_METHOD_NOT_FOUND"
                ));
    }

    private PaymentMethodResponseDto toResponse(PaymentMethod paymentMethod) {
        return PaymentMethodResponseDto.builder()
                .id(paymentMethod.getId())
                .organizationId(paymentMethod.getOrganization().getId())
                .name(paymentMethod.getName())
                .description(paymentMethod.getDescription())
                .status(paymentMethod.getStatus())
                .build();
    }
}
