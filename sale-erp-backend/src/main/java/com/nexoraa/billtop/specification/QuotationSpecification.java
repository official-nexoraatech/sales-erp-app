package com.nexoraa.billtop.specification;

import com.nexoraa.billtop.entity.Quotation;
import jakarta.persistence.criteria.JoinType;
import jakarta.persistence.criteria.Predicate;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.util.StringUtils;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

public final class QuotationSpecification {

    private QuotationSpecification() {
    }

    public static Specification<Quotation> active() {
        return (root, query, criteriaBuilder) -> criteriaBuilder.isFalse(root.get("isDeleted"));
    }

    public static Specification<Quotation> organization(Long organizationId) {
        return (root, query, criteriaBuilder) -> criteriaBuilder.equal(root.get("organization").get("id"), organizationId);
    }

    public static Specification<Quotation> customer(Long customerId) {
        return (root, query, criteriaBuilder) -> {
            if (customerId == null || customerId <= 0) {
                return criteriaBuilder.conjunction();
            }
            return criteriaBuilder.equal(root.get("customer").get("id"), customerId);
        };
    }

    public static Specification<Quotation> status(String status) {
        return (root, query, criteriaBuilder) -> {
            if (!StringUtils.hasText(status)) {
                return criteriaBuilder.conjunction();
            }
            return criteriaBuilder.equal(criteriaBuilder.lower(root.get("status")), status.trim().toLowerCase());
        };
    }

    public static Specification<Quotation> search(String search) {
        return (root, query, criteriaBuilder) -> {
            if (!StringUtils.hasText(search)) {
                return criteriaBuilder.conjunction();
            }

            String pattern = "%" + search.trim().toLowerCase() + "%";
            List<Predicate> predicates = new ArrayList<>();
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.get("quotationNo")), pattern));
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.join("customer", JoinType.LEFT).get("firstName")), pattern));
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.join("customer", JoinType.LEFT).get("lastName")), pattern));
            return criteriaBuilder.or(predicates.toArray(Predicate[]::new));
        };
    }

    public static Specification<Quotation> dateBetween(LocalDate fromDate, LocalDate toDate) {
        return (root, query, criteriaBuilder) -> {
            if (fromDate != null && toDate != null) {
                return criteriaBuilder.between(root.get("quotationDate"), fromDate, toDate);
            }
            if (fromDate != null) {
                return criteriaBuilder.greaterThanOrEqualTo(root.get("quotationDate"), fromDate);
            }
            if (toDate != null) {
                return criteriaBuilder.lessThanOrEqualTo(root.get("quotationDate"), toDate);
            }
            return criteriaBuilder.conjunction();
        };
    }
}
