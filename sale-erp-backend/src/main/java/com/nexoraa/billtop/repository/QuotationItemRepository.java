package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.QuotationItem;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface QuotationItemRepository extends JpaRepository<QuotationItem, Long> {

    List<QuotationItem> findByQuotationIdAndOrganizationIdAndIsDeletedFalse(Long quotationId, Long organizationId);

    void deleteByQuotationIdAndOrganizationId(Long quotationId, Long organizationId);
}
