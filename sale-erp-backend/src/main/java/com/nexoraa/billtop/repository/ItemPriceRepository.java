package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.ItemPrice;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface ItemPriceRepository extends JpaRepository<ItemPrice, Long> {

    Optional<ItemPrice> findTopByItemIdAndOrganizationIdOrderByIdDesc(Long itemId, Long organizationId);
}
