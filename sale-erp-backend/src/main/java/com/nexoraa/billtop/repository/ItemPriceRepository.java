package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.ItemPrice;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface ItemPriceRepository extends JpaRepository<ItemPrice, Long> {

    Optional<ItemPrice> findTopByItemIdOrderByIdDesc(Long itemId);

    @Query("""
            select price.item.id as itemId,
                   price.purchasePrice as purchasePrice,
                   price.salePrice as salePrice
            from ItemPrice price
            where price.item.id in :itemIds
              and price.id in (
                  select max(latestPrice.id)
                  from ItemPrice latestPrice
                  where latestPrice.item.id in :itemIds
                  group by latestPrice.item.id
              )
            """)
    List<ItemPriceSummaryProjection> findLatestPricesByItemIds(@Param("itemIds") Collection<Long> itemIds);
}
