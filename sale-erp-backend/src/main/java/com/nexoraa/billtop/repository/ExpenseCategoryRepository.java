package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.entity.ExpenseCategory;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.Optional;

public interface ExpenseCategoryRepository extends JpaRepository<ExpenseCategory, Long>, JpaSpecificationExecutor<ExpenseCategory> {

    Optional<ExpenseCategory> findByIdAndStatus(Long id, Status status);

    Optional<ExpenseCategory> findByIdAndOrganizationIdAndStatusAndIsDeletedFalse(
            Long id,
            Long organizationId,
            Status status
    );

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

