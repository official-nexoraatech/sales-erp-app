package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.StockAdjustmentItem;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface StockAdjustmentItemRepository extends JpaRepository<StockAdjustmentItem, Long> {

    List<StockAdjustmentItem> findByStockAdjustmentIdAndOrganizationId(Long stockAdjustmentId, Long organizationId);
}
