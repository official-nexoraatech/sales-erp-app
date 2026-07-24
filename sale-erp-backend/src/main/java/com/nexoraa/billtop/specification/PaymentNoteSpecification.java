package com.nexoraa.billtop.specification;

import com.nexoraa.billtop.entity.PaymentNote;
import jakarta.persistence.criteria.Predicate;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.util.StringUtils;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

public final class PaymentNoteSpecification {

    private PaymentNoteSpecification() {
    }

    public static Specification<PaymentNote> notDeleted() {
        return (root, query, criteriaBuilder) -> criteriaBuilder.or(
                criteriaBuilder.isNull(root.get("isDeleted")),
                criteriaBuilder.isFalse(root.get("isDeleted"))
        );
    }

    public static Specification<PaymentNote> organization(Long organizationId) {
        return (root, query, criteriaBuilder) -> criteriaBuilder.equal(root.get("organization").get("id"), organizationId);
    }

    public static Specification<PaymentNote> statusIn(List<String> statuses) {
        return (root, query, criteriaBuilder) -> {
            if (statuses == null || statuses.isEmpty()) {
                return criteriaBuilder.conjunction();
            }
            return root.get("status").in(statuses);
        };
    }

    public static Specification<PaymentNote> priorityIn(List<String> priorities) {
        return (root, query, criteriaBuilder) -> {
            if (priorities == null || priorities.isEmpty()) {
                return criteriaBuilder.conjunction();
            }
            return root.get("priority").in(priorities);
        };
    }

    public static Specification<PaymentNote> noteTypeIn(List<String> noteTypes) {
        return (root, query, criteriaBuilder) -> {
            if (noteTypes == null || noteTypes.isEmpty()) {
                return criteriaBuilder.conjunction();
            }
            return root.get("noteType").in(noteTypes);
        };
    }

    public static Specification<PaymentNote> contact(Long contactId) {
        return (root, query, criteriaBuilder) -> {
            if (contactId == null) {
                return criteriaBuilder.conjunction();
            }
            return criteriaBuilder.equal(root.get("contact").get("id"), contactId);
        };
    }

    public static Specification<PaymentNote> assignedTo(Long userId) {
        return (root, query, criteriaBuilder) -> {
            if (userId == null) {
                return criteriaBuilder.conjunction();
            }
            return criteriaBuilder.equal(root.get("assignedTo").get("id"), userId);
        };
    }

    public static Specification<PaymentNote> search(String search) {
        return (root, query, criteriaBuilder) -> {
            if (!StringUtils.hasText(search)) {
                return criteriaBuilder.conjunction();
            }

            String pattern = "%" + search.trim().toLowerCase() + "%";
            List<Predicate> predicates = new ArrayList<>();
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.get("noteNo")), pattern));
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.get("subject")), pattern));
            return criteriaBuilder.or(predicates.toArray(Predicate[]::new));
        };
    }

    public static Specification<PaymentNote> dateBetween(LocalDate fromDate, LocalDate toDate) {
        return (root, query, criteriaBuilder) -> {
            if (fromDate == null && toDate == null) {
                return criteriaBuilder.conjunction();
            }
            LocalDateTime from = fromDate != null ? fromDate.atStartOfDay() : null;
            LocalDateTime to = toDate != null ? toDate.plusDays(1).atStartOfDay() : null;
            if (from != null && to != null) {
                return criteriaBuilder.between(root.get("createdAt"), from, to);
            }
            if (from != null) {
                return criteriaBuilder.greaterThanOrEqualTo(root.get("createdAt"), from);
            }
            return criteriaBuilder.lessThan(root.get("createdAt"), to);
        };
    }
}
