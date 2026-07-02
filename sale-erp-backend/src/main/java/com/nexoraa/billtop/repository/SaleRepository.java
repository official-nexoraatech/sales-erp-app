package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.Sale;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.List;
import java.util.Optional;

public interface SaleRepository extends JpaRepository<Sale, Long>, JpaSpecificationExecutor<Sale> {

    List<Sale> findByCustomerIdOrderByInvoiceDateAscIdAsc(Long customerId);

    List<Sale> findByCustomerIdAndOrganizationIdOrderByInvoiceDateAscIdAsc(Long customerId, Long organizationId);

    Optional<Sale> findTopByInvoiceNoStartingWithOrderByIdDesc(String prefix);

    Optional<Sale> findTopByInvoiceNoStartingWithAndOrganizationIdOrderByIdDesc(String prefix, Long organizationId);

    Optional<Sale> findByIdAndOrganizationId(Long id, Long organizationId);

    Optional<Sale> findByIdAndOrganizationIdAndIsDeletedFalse(Long id, Long organizationId);
}
