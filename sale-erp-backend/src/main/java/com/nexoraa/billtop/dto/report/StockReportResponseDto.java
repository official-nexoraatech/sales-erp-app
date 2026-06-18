package com.nexoraa.billtop.dto.report;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class StockReportResponseDto {

    private Long itemId;
    private String itemName;
    private Long warehouseId;
    private String warehouseName;
    private Long batchId;
    private String batchNo;
    private BigDecimal availableQty;
    private BigDecimal reorderLevel;
    private BigDecimal stockValue;
}
