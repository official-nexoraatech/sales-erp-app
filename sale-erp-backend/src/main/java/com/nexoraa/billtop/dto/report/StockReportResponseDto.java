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
    private String itemCode;
    private Long brandId;
    private String brandName;
    private Long categoryId;
    private String categoryName;
    private String unitName;
    private Long warehouseId;
    private String warehouseName;
    private BigDecimal availableQty;
    private BigDecimal currentStock;
    private BigDecimal minimumStock;
    private BigDecimal reorderLevel;
    private BigDecimal stockValue;
    private BigDecimal costValue;
    private BigDecimal saleValue;
    private BigDecimal profitValue;
    private String status;
}
