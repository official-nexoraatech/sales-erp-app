package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.SalesReturnItem;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SalesReturnItemRepository extends JpaRepository<SalesReturnItem, Long> {

    List<SalesReturnItem> findBySalesReturnId(Long salesReturnId);

    List<SalesReturnItem> findBySalesReturnIdAndOrganizationId(Long salesReturnId, Long organizationId);
}
