package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.Purchase;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.List;
import java.util.Optional;

public interface PurchaseRepository extends JpaRepository<Purchase, Long>, JpaSpecificationExecutor<Purchase> {

    List<Purchase> findBySupplierIdOrderByPurchaseDateAscIdAsc(Long supplierId);

    List<Purchase> findBySupplierIdAndOrganizationIdOrderByPurchaseDateAscIdAsc(Long supplierId, Long organizationId);

    Optional<Purchase> findTopByPurchaseNoStartingWithOrderByIdDesc(String prefix);

    Optional<Purchase> findTopByPurchaseNoStartingWithAndOrganizationIdOrderByIdDesc(String prefix, Long organizationId);

    Optional<Purchase> findByIdAndOrganizationId(Long id, Long organizationId);

    Optional<Purchase> findByIdAndOrganizationIdAndIsDeletedFalse(Long id, Long organizationId);
}
