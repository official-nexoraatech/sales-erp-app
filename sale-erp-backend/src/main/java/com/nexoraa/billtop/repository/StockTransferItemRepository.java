package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.StockTransferItem;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface StockTransferItemRepository extends JpaRepository<StockTransferItem, Long> {

    List<StockTransferItem> findByStockTransferId(Long stockTransferId);
}
