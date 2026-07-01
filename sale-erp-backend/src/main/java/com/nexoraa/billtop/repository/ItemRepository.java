package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.Item;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.Optional;

public interface ItemRepository extends JpaRepository<Item, Long>, JpaSpecificationExecutor<Item> {

    boolean existsByItemCodeIgnoreCaseAndOrganizationIdAndIsDeletedFalse(String itemCode, Long organizationId);

    boolean existsByItemCodeIgnoreCaseAndIdNotAndOrganizationIdAndIsDeletedFalse(
            String itemCode,
            Long id,
            Long organizationId);

    Optional<Item> findByIdAndOrganizationIdAndIsDeletedFalse(Long id, Long organizationId);

    Optional<Item> findByItemCodeIgnoreCaseAndOrganizationIdAndIsDeletedFalse(String itemCode, Long organizationId);

    Optional<Item> findFirstByItemNameIgnoreCaseAndOrganizationIdAndIsDeletedFalse(String itemName, Long organizationId);
}


