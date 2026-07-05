package com.nexoraa.billtop.specification;

import com.nexoraa.billtop.entity.User;
import jakarta.persistence.criteria.Predicate;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.List;

public final class UserSpecification {

    private UserSpecification() {
    }

    public static Specification<User> notDeleted() {
        return (root, query, criteriaBuilder) -> criteriaBuilder.isFalse(root.get("isDeleted"));
    }

    public static Specification<User> organization(Long organizationId) {
        return (root, query, criteriaBuilder) -> criteriaBuilder.equal(root.get("organization").get("id"), organizationId);
    }

    public static Specification<User> search(String search) {
        return (root, query, criteriaBuilder) -> {
            if (!StringUtils.hasText(search)) {
                return criteriaBuilder.conjunction();
            }

            String pattern = "%" + search.trim().toLowerCase() + "%";
            List<Predicate> predicates = new ArrayList<>();
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.get("firstName")), pattern));
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.get("lastName")), pattern));
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.get("userName")), pattern));
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.get("email")), pattern));
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.get("mobileNo")), pattern));
            return criteriaBuilder.or(predicates.toArray(Predicate[]::new));
        };
    }
}
