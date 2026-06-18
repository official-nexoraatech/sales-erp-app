package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.entity.EmailTemplate;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.Optional;

public interface EmailTemplateRepository extends JpaRepository<EmailTemplate, Long>, JpaSpecificationExecutor<EmailTemplate> {

    boolean existsByNameIgnoreCaseAndStatus(String name, Status status);

    boolean existsByNameIgnoreCaseAndIdNotAndStatus(String name, Long id, Status status);

    Optional<EmailTemplate> findByIdAndStatus(Long id, Status status);
}

