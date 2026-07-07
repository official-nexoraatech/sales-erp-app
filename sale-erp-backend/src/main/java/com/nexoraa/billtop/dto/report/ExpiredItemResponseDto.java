package com.nexoraa.billtop.dto.report;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ExpiredItemResponseDto {

    private Long warehouseId;
    private String warehouseName;
    private Long itemId;
    private String itemName;
    private String brandName;
    private String batchNo;
    private LocalDate expiryDate;
    private Long daysUntilExpiry;
    private BigDecimal availableQty;
}
