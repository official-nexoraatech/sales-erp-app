package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.PurchaseReturnItem;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface PurchaseReturnItemRepository extends JpaRepository<PurchaseReturnItem, Long> {

    List<PurchaseReturnItem> findByPurchaseReturnId(Long purchaseReturnId);

    List<PurchaseReturnItem> findByPurchaseReturnIdAndOrganizationId(Long purchaseReturnId, Long organizationId);
}
