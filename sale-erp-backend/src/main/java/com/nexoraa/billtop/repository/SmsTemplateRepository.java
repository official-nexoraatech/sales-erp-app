package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.entity.SmsTemplate;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.Optional;

public interface SmsTemplateRepository extends JpaRepository<SmsTemplate, Long>, JpaSpecificationExecutor<SmsTemplate> {

    boolean existsByNameIgnoreCaseAndOrganizationIdAndStatus(String name, Long organizationId, Status status);

    boolean existsByNameIgnoreCaseAndIdNotAndOrganizationIdAndStatus(String name, Long id, Long organizationId, Status status);

    Optional<SmsTemplate> findByIdAndOrganizationIdAndStatus(Long id, Long organizationId, Status status);
}

