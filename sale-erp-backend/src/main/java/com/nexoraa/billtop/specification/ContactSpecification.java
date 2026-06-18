package com.nexoraa.billtop.specification;

import com.nexoraa.billtop.entity.Contact;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.List;

public final class ContactSpecification {

    private ContactSpecification() {
    }

    public static Specification<Contact> activeByType(String contactType) {
        return (root, query, criteriaBuilder) -> criteriaBuilder.and(
                criteriaBuilder.equal(root.get("contactType"), contactType),
                criteriaBuilder.equal(root.get("status"), com.nexoraa.billtop.enums.Status.ACTIVE)
        );
    }

    public static Specification<Contact> organization(Long organizationId) {
        return (root, query, criteriaBuilder) -> criteriaBuilder.equal(root.get("organization").get("id"), organizationId);
    }

    public static Specification<Contact> search(String search) {
        return (root, query, criteriaBuilder) -> {
            if (!StringUtils.hasText(search)) {
                return criteriaBuilder.conjunction();
            }

            String pattern = "%" + search.trim().toLowerCase() + "%";
            List<jakarta.persistence.criteria.Predicate> predicates = new ArrayList<>();
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.get("companyName")), pattern));
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.get("firstName")), pattern));
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.get("lastName")), pattern));
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.get("email")), pattern));
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.get("mobile")), pattern));
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.get("phone")), pattern));
            return criteriaBuilder.or(predicates.toArray(jakarta.persistence.criteria.Predicate[]::new));
        };
    }
}

