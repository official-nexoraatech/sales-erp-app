package com.nexoraa.billtop.dto.warehouse;

import com.nexoraa.billtop.enums.Status;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class WarehouseResponseDto {

    private Long id;
    private String name;
    private String warehouseCode;
    private String description;
    private String address;
    private Status status;
    private Long totalItems;
    private BigDecimal availableStock;
    private BigDecimal worthCost;
    private BigDecimal worthSale;
    private BigDecimal worthProfit;
    private String createdBy;
    private LocalDateTime createdAt;
}

