package com.nexoraa.billtop.service;

import com.nexoraa.billtop.entity.Item;
import com.nexoraa.billtop.entity.Stock;
import com.nexoraa.billtop.enums.ItemStatus;
import com.nexoraa.billtop.repository.ItemRepository;
import com.nexoraa.billtop.repository.StockRepository;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;

@Service
public class ItemStockStatusService {

    private static final BigDecimal ZERO = BigDecimal.ZERO;

    private final ItemRepository itemRepository;
    private final StockRepository stockRepository;

    public ItemStockStatusService(ItemRepository itemRepository, StockRepository stockRepository) {
        this.itemRepository = itemRepository;
        this.stockRepository = stockRepository;
    }

    public void SaveItemStockStatus(Item item) {
        if (item == null || item.getId() == null) {
            return;
        }
        Stock stock = stockRepository.findFirstByItemIdOrderByIdAsc(item.getId());
        BigDecimal available = stock != null ? defaultZero(stock.getAvailableQty()) : ZERO;
        BigDecimal minimum = stock != null ? defaultZero(stock.getMinimumStock()) : ZERO;
        if (available.compareTo(ZERO) <= 0) {
            item.setStatus(ItemStatus.OUT_OF_STOCK);
        } else if (available.compareTo(minimum) <= 0) {
            item.setStatus(ItemStatus.LOW_STOCK);
        } else {
            item.setStatus(ItemStatus.IN_STOCK);
        }
        itemRepository.save(item);

    }

    private BigDecimal defaultZero(BigDecimal value) {
        return value == null ? ZERO : value;
    }
}
