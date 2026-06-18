package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.Expense;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

public interface ExpenseRepository extends JpaRepository<Expense, Long> {

    Optional<Expense> findTopByExpenseNoStartingWithOrderByIdDesc(String prefix);

    Optional<Expense> findTopByExpenseNoStartingWithAndOrganizationIdOrderByIdDesc(String prefix, Long organizationId);

    List<Expense> findByExpenseDateBetweenOrderByExpenseDateAscIdAsc(LocalDate fromDate, LocalDate toDate);

    List<Expense> findByExpenseDateBetweenAndOrganizationIdOrderByExpenseDateAscIdAsc(
            LocalDate fromDate,
            LocalDate toDate,
            Long organizationId
    );

    Optional<Expense> findByIdAndOrganizationId(Long id, Long organizationId);

    Page<Expense> findByOrganizationId(Long organizationId, Pageable pageable);
}
