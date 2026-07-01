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

    public void refreshStatus(Item item) {
        if (item == null || item.getId() == null) {
            return;
        }
        item.setStatus(calculateStatus(item.getId()));
        itemRepository.save(item);
    }

    public ItemStatus calculateStatus(Long itemId) {
        BigDecimal availableQty = ZERO;
        BigDecimal minimumStock = ZERO;
        for (Stock stock : stockRepository.findByItemId(itemId)) {
            availableQty = availableQty.add(defaultZero(stock.getAvailableQty()));
            minimumStock = minimumStock.add(defaultZero(stock.getMinimumStock()));
        }
        return calculateStatus(availableQty, minimumStock);
    }

    public ItemStatus calculateStatus(BigDecimal availableQty, BigDecimal minimumStock) {
        BigDecimal available = defaultZero(availableQty);
        BigDecimal minimum = defaultZero(minimumStock);
        if (available.compareTo(ZERO) <= 0) {
            return ItemStatus.OUT_OF_STOCK;
        }
        if (minimum.compareTo(ZERO) > 0 && available.compareTo(minimum) <= 0) {
            return ItemStatus.LOW_STOCK;
        }
        return ItemStatus.IN_STOCK;
    }

    private BigDecimal defaultZero(BigDecimal value) {
        return value == null ? ZERO : value;
    }
}
