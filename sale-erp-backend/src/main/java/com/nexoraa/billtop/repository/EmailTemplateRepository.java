package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.entity.EmailTemplate;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.Optional;

public interface EmailTemplateRepository extends JpaRepository<EmailTemplate, Long>, JpaSpecificationExecutor<EmailTemplate> {

    boolean existsByNameIgnoreCaseAndOrganizationIdAndStatus(String name, Long organizationId, Status status);

    boolean existsByNameIgnoreCaseAndIdNotAndOrganizationIdAndStatus(String name, Long id, Long organizationId, Status status);

    Optional<EmailTemplate> findByIdAndOrganizationIdAndStatus(Long id, Long organizationId, Status status);
}

