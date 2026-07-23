package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.Stock;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface StockRepository extends JpaRepository<Stock, Long> {

    List<Stock> findByItemId(Long itemId);

    List<Stock> findByItemIdOrderByIdAsc(Long itemId);

    List<Stock> findByItem_Organization_Id(Long organizationId);

    List<Stock> findByWarehouse_IdInAndItem_Organization_Id(
            Collection<Long> warehouseIds,
            Long organizationId
    );

    List<Stock> findByItemIdAndWarehouseIdOrderByIdAsc(
            Long itemId,
            Long warehouseId
    );

    Optional<Stock> findFirstByItemIdAndWarehouseIdAndBatchId(
            Long itemId,
            Long warehouseId,
            Long batchId
    );
}
