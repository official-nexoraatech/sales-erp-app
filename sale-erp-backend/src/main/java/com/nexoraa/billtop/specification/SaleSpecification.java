package com.nexoraa.billtop.specification;

import com.nexoraa.billtop.entity.Sale;
import jakarta.persistence.criteria.JoinType;
import jakarta.persistence.criteria.Predicate;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.util.StringUtils;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

public final class SaleSpecification {

    private SaleSpecification() {
    }

    public static Specification<Sale> notCancelled() {
        return (root, query, criteriaBuilder) -> criteriaBuilder.or(
                criteriaBuilder.isNull(root.get("status")),
                criteriaBuilder.notEqual(root.get("status"), "CANCELLED")
        );
    }

    public static Specification<Sale> notDeleted() {
        return (root, query, criteriaBuilder) -> criteriaBuilder.or(
                criteriaBuilder.isNull(root.get("isDeleted")),
                criteriaBuilder.isFalse(root.get("isDeleted"))
        );
    }

    public static Specification<Sale> organization(Long organizationId) {
        return (root, query, criteriaBuilder) -> criteriaBuilder.equal(root.get("organization").get("id"), organizationId);
    }

    public static Specification<Sale> statusIn(List<String> statuses) {
        return (root, query, criteriaBuilder) -> {
            if (statuses == null || statuses.isEmpty()) {
                return criteriaBuilder.conjunction();
            }
            return root.get("status").in(statuses);
        };
    }

    public static Specification<Sale> customer(Long customerId) {
        return (root, query, criteriaBuilder) -> {
            if (customerId == null) {
                return criteriaBuilder.conjunction();
            }
            return criteriaBuilder.equal(root.get("customer").get("id"), customerId);
        };
    }

    public static Specification<Sale> search(String search) {
        return (root, query, criteriaBuilder) -> {
            if (!StringUtils.hasText(search)) {
                return criteriaBuilder.conjunction();
            }

            String pattern = "%" + search.trim().toLowerCase() + "%";
            List<Predicate> predicates = new ArrayList<>();
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.get("invoiceNo")), pattern));
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.join("customer", JoinType.LEFT).get("firstName")), pattern));
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.join("customer", JoinType.LEFT).get("lastName")), pattern));
            return criteriaBuilder.or(predicates.toArray(Predicate[]::new));
        };
    }

    public static Specification<Sale> dateBetween(LocalDate fromDate, LocalDate toDate) {
        return (root, query, criteriaBuilder) -> {
            if (fromDate != null && toDate != null) {
                return criteriaBuilder.between(root.get("invoiceDate"), fromDate, toDate);
            }
            if (fromDate != null) {
                return criteriaBuilder.greaterThanOrEqualTo(root.get("invoiceDate"), fromDate);
            }
            if (toDate != null) {
                return criteriaBuilder.lessThanOrEqualTo(root.get("invoiceDate"), toDate);
            }
            return criteriaBuilder.conjunction();
        };
    }
}
