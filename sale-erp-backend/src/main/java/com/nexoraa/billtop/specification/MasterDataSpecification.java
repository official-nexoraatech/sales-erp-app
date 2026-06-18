package com.nexoraa.billtop.specification;

import org.springframework.data.jpa.domain.Specification;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.List;

public final class MasterDataSpecification {

    private MasterDataSpecification() {
    }

    public static <T> Specification<T> active() {
        return (root, query, criteriaBuilder) -> criteriaBuilder.equal(root.get("status"), com.nexoraa.billtop.enums.Status.ACTIVE);
    }

    public static <T> Specification<T> organization(Long organizationId) {
        return (root, query, criteriaBuilder) -> criteriaBuilder.equal(root.get("organization").get("id"), organizationId);
    }

    public static <T> Specification<T> search(String search, String... fields) {
        return (root, query, criteriaBuilder) -> {
            if (!StringUtils.hasText(search)) {
                return criteriaBuilder.conjunction();
            }

            String pattern = "%" + search.trim().toLowerCase() + "%";
            List<jakarta.persistence.criteria.Predicate> predicates = new ArrayList<>();
            for (String field : fields) {
                predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.get(field).as(String.class)), pattern));
            }
            return criteriaBuilder.or(predicates.toArray(jakarta.persistence.criteria.Predicate[]::new));
        };
    }
}

