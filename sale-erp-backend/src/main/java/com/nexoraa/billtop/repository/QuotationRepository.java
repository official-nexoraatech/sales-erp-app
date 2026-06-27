package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.Quotation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.Optional;

public interface QuotationRepository extends JpaRepository<Quotation, Long>, JpaSpecificationExecutor<Quotation> {

    Optional<Quotation> findTopByQuotationNoStartingWithAndOrganizationIdOrderByIdDesc(String prefix, Long organizationId);

    Optional<Quotation> findByIdAndOrganizationIdAndIsDeletedFalse(Long id, Long organizationId);
}
