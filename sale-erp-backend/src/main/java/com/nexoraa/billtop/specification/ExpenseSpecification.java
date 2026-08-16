package com.nexoraa.billtop.specification;

import com.nexoraa.billtop.entity.Expense;
import jakarta.persistence.criteria.JoinType;
import org.springframework.data.jpa.domain.Specification;

import java.time.LocalDate;
import java.util.Locale;

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

    public static Specification<Expense> search(String search) {
        return (root, query, criteriaBuilder) -> {
            if (search == null || search.isBlank()) {
                return criteriaBuilder.conjunction();
            }
            String token = "%" + search.trim().toLowerCase(Locale.ROOT) + "%";
            var category = root.join("expenseCategory", JoinType.LEFT);
            var subCategory = root.join("expenseSubCategory", JoinType.LEFT);
            var paymentMethod = root.join("paymentMethod", JoinType.LEFT);
            return criteriaBuilder.or(
                    criteriaBuilder.like(criteriaBuilder.lower(root.get("expenseNo")), token),
                    criteriaBuilder.like(criteriaBuilder.lower(root.get("notes")), token),
                    criteriaBuilder.like(criteriaBuilder.lower(category.get("name")), token),
                    criteriaBuilder.like(criteriaBuilder.lower(subCategory.get("name")), token),
                    criteriaBuilder.like(criteriaBuilder.lower(paymentMethod.get("name")), token)
            );
        };
    }
}
