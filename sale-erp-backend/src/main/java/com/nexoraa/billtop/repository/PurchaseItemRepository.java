package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.PurchaseItem;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface PurchaseItemRepository extends JpaRepository<PurchaseItem, Long> {

    List<PurchaseItem> findByPurchaseId(Long purchaseId);

    List<PurchaseItem> findByPurchaseIdAndOrganizationId(Long purchaseId, Long organizationId);

    void deleteByPurchaseId(Long purchaseId);

    void deleteByPurchaseIdAndOrganizationId(Long purchaseId, Long organizationId);
}
