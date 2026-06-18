package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.ItemBatch;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface ItemBatchRepository extends JpaRepository<ItemBatch, Long> {

    Optional<ItemBatch> findTopByItemIdAndOrganizationIdOrderByIdDesc(Long itemId, Long organizationId);

    Optional<ItemBatch> findByItemIdAndBatchNoAndOrganizationId(Long itemId, String batchNo, Long organizationId);
}
