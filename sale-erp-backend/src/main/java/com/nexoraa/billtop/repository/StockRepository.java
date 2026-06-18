package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.Stock;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface StockRepository extends JpaRepository<Stock, Long> {

    List<Stock> findByItemIdAndOrganizationId(Long itemId, Long organizationId);

    List<Stock> findByOrganizationId(Long organizationId);

    List<Stock> findByItemIdAndWarehouseIdAndOrganizationIdOrderByIdAsc(
            Long itemId,
            Long warehouseId,
            Long organizationId
    );

    Optional<Stock> findFirstByItemIdAndWarehouseIdAndBatchIdAndOrganizationId(
            Long itemId,
            Long warehouseId,
            Long batchId,
            Long organizationId
    );
}
