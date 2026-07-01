package com.nexoraa.billtop.dto.item;

import com.nexoraa.billtop.enums.ItemStatus;
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
public class ItemListResponseDto {

    private Long id;
    private String itemName;
    private String itemCode;
    private String sku;
    private String hsnCode;
    private Long categoryId;
    private String categoryName;
    private Long subCategoryId;
    private String subCategoryName;
    private Long brandId;
    private String brandName;
    private Long baseUnitId;
    private String baseUnitName;
    private String unitName;
    private BigDecimal purchasePrice;
    private BigDecimal purchasePriceWithTax;
    private BigDecimal taxPercentage;
    private BigDecimal salePrice;
    private BigDecimal wholesalePrice;
    private BigDecimal mrp;
    private BigDecimal msp;
    private BigDecimal discountPercentage;
    private BigDecimal profitMargin;
    private String batchNo;
    private LocalDate manufacturingDate;
    private LocalDate expiryDate;
    private BigDecimal openingQuantity;
    private BigDecimal availableQty;
    private BigDecimal reservedQty;
    private BigDecimal minimumStock;
    private Long warehouseId;
    private String warehouseName;
    private String description;
    private ItemStatus status;
}
