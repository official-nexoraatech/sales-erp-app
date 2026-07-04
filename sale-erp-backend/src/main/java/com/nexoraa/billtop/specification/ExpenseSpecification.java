package com.nexoraa.billtop.specification;

import com.nexoraa.billtop.entity.Expense;
import org.springframework.data.jpa.domain.Specification;

import java.time.LocalDate;

public final class ExpenseSpecification {

    private ExpenseSpecification() {
    }

    public static Specification<Expense> notDeleted() {
        return (root, query, criteriaBuilder) -> criteriaBuilder.or(
                criteriaBuilder.isNull(root.get("isDeleted")),
                criteriaBuilder.isFalse(root.get("isDeleted"))
        );
    }

    public static Specification<Expense> organization(Long organizationId) {
        return (root, query, criteriaBuilder) -> criteriaBuilder.equal(root.get("organization").get("id"), organizationId);
    }

    public static Specification<Expense> dateBetween(LocalDate fromDate, LocalDate toDate) {
        return (root, query, criteriaBuilder) -> {
            if (fromDate != null && toDate != null) {
                return criteriaBuilder.between(root.get("expenseDate"), fromDate, toDate);
            }
            if (fromDate != null) {
                return criteriaBuilder.greaterThanOrEqualTo(root.get("expenseDate"), fromDate);
            }
            if (toDate != null) {
                return criteriaBuilder.lessThanOrEqualTo(root.get("expenseDate"), toDate);
            }
            return criteriaBuilder.conjunction();
        };
    }
}
