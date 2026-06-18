package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.entity.ShippingCarrier;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.Optional;

public interface ShippingCarrierRepository extends JpaRepository<ShippingCarrier, Long>, JpaSpecificationExecutor<ShippingCarrier> {

    Optional<ShippingCarrier> findByIdAndStatus(Long id, Status status);

    Optional<ShippingCarrier> findByIdAndOrganizationIdAndStatusAndIsDeletedFalse(
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

