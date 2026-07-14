package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.PurchaseItem;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.math.BigDecimal;
import java.util.List;

public interface PurchaseItemRepository extends JpaRepository<PurchaseItem, Long> {

    List<PurchaseItem> findByPurchaseId(Long purchaseId);

    List<PurchaseItem> findByPurchaseIdAndOrganizationId(Long purchaseId, Long organizationId);

    void deleteByPurchaseId(Long purchaseId);

    void deleteByPurchaseIdAndOrganizationId(Long purchaseId, Long organizationId);

    @Query("SELECT COALESCE(SUM(pi.qty), 0) FROM PurchaseItem pi WHERE pi.purchase.id = :purchaseId AND pi.organization.id = :organizationId")
    BigDecimal sumQuantityByPurchaseIdAndOrganizationId(@Param("purchaseId") Long purchaseId, @Param("organizationId") Long organizationId);
}
