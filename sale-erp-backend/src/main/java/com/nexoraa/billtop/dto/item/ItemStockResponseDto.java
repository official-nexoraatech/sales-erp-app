package com.nexoraa.billtop.dto.item;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ItemStockResponseDto {

    private Long itemId;
    private String itemName;
    private BigDecimal availableQty;
    private BigDecimal reservedQty;
    private String warehouse;
}
