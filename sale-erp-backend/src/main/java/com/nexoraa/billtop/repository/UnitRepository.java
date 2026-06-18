package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.entity.Unit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.Optional;

public interface UnitRepository extends JpaRepository<Unit, Long>, JpaSpecificationExecutor<Unit> {

    boolean existsByNameIgnoreCaseAndOrganizationIdAndStatusAndIsDeletedFalse(String name, Long organizationId, Status status);

    boolean existsByNameIgnoreCaseAndIdNotAndOrganizationIdAndStatusAndIsDeletedFalse(
            String name,
            Long id,
            Long organizationId,
            Status status
    );

    Optional<Unit> findByIdAndOrganizationIdAndStatusAndIsDeletedFalse(Long id, Long organizationId, Status status);
}

