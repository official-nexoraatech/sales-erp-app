package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.StockAdjustment;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import java.util.Optional;

public interface StockAdjustmentRepository extends JpaRepository<StockAdjustment, Long> {

    Optional<StockAdjustment> findTopByAdjustmentNoStartingWithAndOrganizationIdOrderByIdDesc(
            String prefix,
            Long organizationId
    );

    Page<StockAdjustment> findByOrganizationIdAndIsDeletedFalse(Long organizationId, Pageable pageable);

    Optional<StockAdjustment> findByIdAndOrganizationIdAndIsDeletedFalse(Long id, Long organizationId);
}
