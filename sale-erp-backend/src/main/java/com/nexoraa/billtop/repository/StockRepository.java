package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.Stock;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface StockRepository extends JpaRepository<Stock, Long> {

    Stock findByItemId(Long itemId);

    Stock findByItemIdOrderByIdAsc(Long itemId);

    Stock findByItem_Organization_Id(Long organizationId);

    List<Stock> findByWarehouse_IdInAndItem_Organization_Id(
            Collection<Long> warehouseIds,
            Long organizationId
    );

    Optional<Stock> findByItemIdAndWarehouseId(
            Long itemId,
            Long warehouseId
    );
}
