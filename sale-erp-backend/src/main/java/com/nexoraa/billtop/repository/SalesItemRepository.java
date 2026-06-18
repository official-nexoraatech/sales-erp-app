package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.SalesItem;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SalesItemRepository extends JpaRepository<SalesItem, Long> {

    List<SalesItem> findBySaleId(Long saleId);

    List<SalesItem> findBySaleIdAndOrganizationId(Long saleId, Long organizationId);

    void deleteBySaleId(Long saleId);

    void deleteBySaleIdAndOrganizationId(Long saleId, Long organizationId);

    List<SalesItem> findByOrganizationId(Long organizationId);
}
