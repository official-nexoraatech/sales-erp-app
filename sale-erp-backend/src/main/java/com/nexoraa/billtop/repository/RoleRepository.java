package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.entity.Role;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.Optional;

public interface RoleRepository extends JpaRepository<Role, Long>, JpaSpecificationExecutor<Role> {

    Optional<Role> findByIdAndStatusAndIsDeletedFalse(Long id, Status status);

    Optional<Role> findByIdAndOrganizationIdAndStatusAndIsDeletedFalse(Long id, Long organizationId, Status status);

    boolean existsByNameIgnoreCase(String name);

    boolean existsByNameIgnoreCaseAndIdNot(String name, Long id);

    boolean existsByNameIgnoreCaseAndOrganizationIdAndStatusAndIsDeletedFalse(
            String name,
            Long organizationId,
            Status status
    );

    boolean existsByNameIgnoreCaseAndIdNotAndOrganizationIdAndStatusAndIsDeletedFalse(
            String name,
            Long id,
            Long organizationId,
            Status status
    );
}

