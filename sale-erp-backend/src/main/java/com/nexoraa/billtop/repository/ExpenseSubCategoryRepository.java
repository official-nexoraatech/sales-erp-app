package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.ExpenseSubCategory;
import com.nexoraa.billtop.enums.Status;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.List;
import java.util.Optional;

public interface ExpenseSubCategoryRepository extends JpaRepository<ExpenseSubCategory, Long>, JpaSpecificationExecutor<ExpenseSubCategory> {

    Optional<ExpenseSubCategory> findByIdAndStatusAndIsDeletedFalse(Long id, Status status);

    Optional<ExpenseSubCategory> findByIdAndExpenseCategoryOrganizationIdAndStatusAndIsDeletedFalse(
            Long id,
            Long organizationId,
            Status status
    );

    List<ExpenseSubCategory> findAllByExpenseCategoryIdAndStatusAndIsDeletedFalseOrderByNameAsc(
            Long expenseCategoryId,
            Status status
    );

    List<ExpenseSubCategory> findAllByExpenseCategoryIdAndExpenseCategoryOrganizationIdAndStatusAndIsDeletedFalseOrderByNameAsc(
            Long expenseCategoryId,
            Long organizationId,
            Status status
    );

    boolean existsByNameIgnoreCaseAndExpenseCategoryIdAndStatusAndIsDeletedFalse(
            String name,
            Long expenseCategoryId,
            Status status
    );

    boolean existsByNameIgnoreCaseAndIdNotAndExpenseCategoryIdAndStatusAndIsDeletedFalse(
            String name,
            Long id,
            Long expenseCategoryId,
            Status status
    );
}
