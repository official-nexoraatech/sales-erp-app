package com.nexoraa.billtop.specification;

import com.nexoraa.billtop.entity.Item;
import jakarta.persistence.criteria.JoinType;
import jakarta.persistence.criteria.Predicate;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.List;

public final class ItemSpecification {

    private ItemSpecification() {
    }

    public static Specification<Item> active() {
        return (root, query, criteriaBuilder) -> criteriaBuilder.equal(root.get("status"), com.nexoraa.billtop.enums.Status.ACTIVE);
    }

    public static Specification<Item> organization(Long organizationId) {
        return (root, query, criteriaBuilder) -> criteriaBuilder.equal(root.get("organization").get("id"), organizationId);
    }

    public static Specification<Item> search(String search) {
        return (root, query, criteriaBuilder) -> {
            if (!StringUtils.hasText(search)) {
                return criteriaBuilder.conjunction();
            }

            if (query != null) {
                query.distinct(true);
            }

            String pattern = "%" + search.trim().toLowerCase() + "%";
            List<Predicate> predicates = new ArrayList<>();
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.get("itemName")), pattern));
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.get("itemCode")), pattern));
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.get("sku")), pattern));
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.get("hsnCode")), pattern));
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.join("category", JoinType.LEFT).get("name")), pattern));
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.join("brand", JoinType.LEFT).get("name")), pattern));
            return criteriaBuilder.or(predicates.toArray(Predicate[]::new));
        };
    }
}

