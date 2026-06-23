package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.entity.PaymentMethod;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.Optional;

public interface PaymentMethodRepository extends JpaRepository<PaymentMethod, Long>, JpaSpecificationExecutor<PaymentMethod> {

    Optional<PaymentMethod> findByIdAndStatus(Long id, Status status);

    Optional<PaymentMethod> findByIdAndOrganizationIdAndStatusAndIsDeletedFalse(
            Long id,
            Long organizationId,
            Status status
    );

    boolean existsByNameIgnoreCaseAndOrganizationIdAndStatusAndIsDeletedFalse(
            String name,
            Long organizationId,
            Status status
    );

    boolean existsByNameIgnoreCaseAndIdNotAndOrganizationIdAndStatusAndIsDeletedFalse(
            String name,
            Long id,
            Long organizationId,
            Status status
    );
}

