package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.entity.Item;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.Optional;

public interface ItemRepository extends JpaRepository<Item, Long>, JpaSpecificationExecutor<Item> {

    boolean existsByItemCodeIgnoreCaseAndOrganizationIdAndStatus(String itemCode, Long organizationId, Status status);

    boolean existsByItemCodeIgnoreCaseAndIdNotAndOrganizationIdAndStatus(
            String itemCode,
            Long id,
            Long organizationId,
    Status status);

    Optional<Item> findByIdAndOrganizationIdAndStatus(Long id, Long organizationId, Status status);

    Optional<Item> findByItemCodeIgnoreCaseAndOrganizationIdAndStatus(String itemCode, Long organizationId, Status status);

    Optional<Item> findFirstByItemNameIgnoreCaseAndOrganizationIdAndStatus(String itemName, Long organizationId, Status status);
}


