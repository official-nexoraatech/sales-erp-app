package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.entity.SmsTemplate;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.Optional;

public interface SmsTemplateRepository extends JpaRepository<SmsTemplate, Long>, JpaSpecificationExecutor<SmsTemplate> {

    boolean existsByNameIgnoreCaseAndStatus(String name, Status status);

    boolean existsByNameIgnoreCaseAndIdNotAndStatus(String name, Long id, Status status);

    Optional<SmsTemplate> findByIdAndStatus(Long id, Status status);
}

