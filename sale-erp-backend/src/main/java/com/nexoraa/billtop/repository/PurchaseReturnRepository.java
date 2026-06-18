package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.PurchaseReturn;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface PurchaseReturnRepository extends JpaRepository<PurchaseReturn, Long> {

    Optional<PurchaseReturn> findTopByOrderByIdDesc();

    Optional<PurchaseReturn> findTopByOrganizationIdOrderByIdDesc(Long organizationId);

    List<PurchaseReturn> findBySupplierIdOrderByReturnDateAscIdAsc(Long supplierId);

    List<PurchaseReturn> findBySupplierIdAndOrganizationIdOrderByReturnDateAscIdAsc(Long supplierId, Long organizationId);

    Optional<PurchaseReturn> findByIdAndOrganizationId(Long id, Long organizationId);

    Page<PurchaseReturn> findByOrganizationId(Long organizationId, Pageable pageable);
}
