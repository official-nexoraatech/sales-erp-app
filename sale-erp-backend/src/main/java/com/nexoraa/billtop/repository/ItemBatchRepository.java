package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.ItemBatch;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface ItemBatchRepository extends JpaRepository<ItemBatch, Long> {

    Optional<ItemBatch> findTopByItemIdOrderByIdDesc(Long itemId);

    Optional<ItemBatch> findByIdAndItemId(Long id, Long itemId);

    Optional<ItemBatch> findByItemIdAndBatchNo(Long itemId, String batchNo);
}
