package com.nexoraa.billtop.dto.stock;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class StockAdjustmentItemResponseDto {

    private Long itemId;
    private String itemName;
    private Long batchId;
    private String batchNo;
    private BigDecimal currentQty;
    private BigDecimal actualQty;
    private BigDecimal differenceQty;
}
