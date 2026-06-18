package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.entity.Organization;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.Optional;

public interface OrganizationRepository extends JpaRepository<Organization, Long>, JpaSpecificationExecutor<Organization> {

    boolean existsByNameIgnoreCaseAndStatus(String name, Status status);

    boolean existsByNameIgnoreCaseAndIdNotAndStatus(String name, Long id, Status status);

    Optional<Organization> findByIdAndStatusAndIsDeletedFalse(Long id, Status status);
}

