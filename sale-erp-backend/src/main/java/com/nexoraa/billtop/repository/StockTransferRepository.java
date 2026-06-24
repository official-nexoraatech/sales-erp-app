package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.StockTransfer;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface StockTransferRepository extends JpaRepository<StockTransfer, Long> {

    Optional<StockTransfer> findTopByTransferNoStartingWithAndOrganizationIdOrderByIdDesc(
            String prefix,
            Long organizationId
    );

    Page<StockTransfer> findByOrganizationIdAndIsDeletedFalse(Long organizationId, Pageable pageable);

    Optional<StockTransfer> findByIdAndOrganizationIdAndIsDeletedFalse(Long id, Long organizationId);
}
