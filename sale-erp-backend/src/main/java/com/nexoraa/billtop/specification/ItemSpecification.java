package com.nexoraa.billtop.specification;

import com.nexoraa.billtop.entity.Item;
import com.nexoraa.billtop.entity.Stock;
import com.nexoraa.billtop.enums.ItemStatus;
import jakarta.persistence.criteria.Root;
import jakarta.persistence.criteria.Subquery;
import jakarta.persistence.criteria.JoinType;
import jakarta.persistence.criteria.Predicate;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.List;

public final class ItemSpecification {

    private ItemSpecification() {
    }

    public static Specification<Item> notDeleted() {
        return (root, query, criteriaBuilder) -> criteriaBuilder.isFalse(root.get("isDeleted"));
    }

    public static Specification<Item> organization(Long organizationId) {
        return (root, query, criteriaBuilder) -> criteriaBuilder.equal(root.get("organization").get("id"), organizationId);
    }

    public static Specification<Item> category(Long categoryId) {
        return (root, query, criteriaBuilder) -> {
            if (categoryId == null || categoryId <= 0) {
                return criteriaBuilder.conjunction();
            }
            return criteriaBuilder.equal(root.get("category").get("id"), categoryId);
        };
    }

    public static Specification<Item> brand(Long brandId) {
        return (root, query, criteriaBuilder) -> {
            if (brandId == null || brandId <= 0) {
                return criteriaBuilder.conjunction();
            }
            return criteriaBuilder.equal(root.get("brand").get("id"), brandId);
        };
    }

    public static Specification<Item> warehouse(Long warehouseId) {
        return (root, query, criteriaBuilder) -> {
            if (warehouseId == null || warehouseId <= 0 || query == null) {
                return criteriaBuilder.conjunction();
            }

            Subquery<Long> subquery = query.subquery(Long.class);
            Root<Stock> stock = subquery.from(Stock.class);
            subquery.select(stock.get("item").get("id"))
                    .where(criteriaBuilder.equal(stock.get("warehouse").get("id"), warehouseId));
            return root.get("id").in(subquery);
        };
    }

    public static Specification<Item> status(ItemStatus status) {
        return (root, query, criteriaBuilder) -> {
            if (status == null) {
                return criteriaBuilder.conjunction();
            }
            return criteriaBuilder.equal(root.get("status"), status);
        };
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
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.get("status").as(String.class)), pattern));
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.join("category", JoinType.LEFT).get("name")), pattern));
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.join("brand", JoinType.LEFT).get("name")), pattern));
            return criteriaBuilder.or(predicates.toArray(Predicate[]::new));
        };
    }
}

