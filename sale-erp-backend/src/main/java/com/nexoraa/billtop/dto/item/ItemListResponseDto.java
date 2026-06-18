package com.nexoraa.billtop.dto.item;

import com.nexoraa.billtop.enums.Status;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ItemListResponseDto {

    private Long id;
    private String itemName;
    private String itemCode;
    private String sku;
    private String categoryName;
    private String brandName;
    private BigDecimal salePrice;
    private BigDecimal availableQty;
    private Status status;
}

