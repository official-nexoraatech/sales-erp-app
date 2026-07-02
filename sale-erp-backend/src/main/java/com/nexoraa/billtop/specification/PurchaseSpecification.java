package com.nexoraa.billtop.specification;

import com.nexoraa.billtop.entity.Purchase;
import jakarta.persistence.criteria.JoinType;
import jakarta.persistence.criteria.Predicate;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.util.StringUtils;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

public final class PurchaseSpecification {

    private PurchaseSpecification() {
    }

    public static Specification<Purchase> notCancelled() {
        return (root, query, criteriaBuilder) -> criteriaBuilder.or(
                criteriaBuilder.isNull(root.get("status")),
                criteriaBuilder.notEqual(root.get("status"), "CANCELLED")
        );
    }

    public static Specification<Purchase> notDeleted() {
        return (root, query, criteriaBuilder) -> criteriaBuilder.or(
                criteriaBuilder.isNull(root.get("isDeleted")),
                criteriaBuilder.isFalse(root.get("isDeleted"))
        );
    }

    public static Specification<Purchase> organization(Long organizationId) {
        return (root, query, criteriaBuilder) -> criteriaBuilder.equal(root.get("organization").get("id"), organizationId);
    }

    public static Specification<Purchase> search(String search) {
        return (root, query, criteriaBuilder) -> {
            if (!StringUtils.hasText(search)) {
                return criteriaBuilder.conjunction();
            }

            String pattern = "%" + search.trim().toLowerCase() + "%";
            List<Predicate> predicates = new ArrayList<>();
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.get("purchaseNo")), pattern));
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.get("referenceNo")), pattern));
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.join("supplier", JoinType.LEFT).get("firstName")), pattern));
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.join("supplier", JoinType.LEFT).get("lastName")), pattern));
            return criteriaBuilder.or(predicates.toArray(Predicate[]::new));
        };
    }

    public static Specification<Purchase> dateBetween(LocalDate fromDate, LocalDate toDate) {
        return (root, query, criteriaBuilder) -> {
            if (fromDate != null && toDate != null) {
                return criteriaBuilder.between(root.get("purchaseDate"), fromDate, toDate);
            }
            if (fromDate != null) {
                return criteriaBuilder.greaterThanOrEqualTo(root.get("purchaseDate"), fromDate);
            }
            if (toDate != null) {
                return criteriaBuilder.lessThanOrEqualTo(root.get("purchaseDate"), toDate);
            }
            return criteriaBuilder.conjunction();
        };
    }
}
