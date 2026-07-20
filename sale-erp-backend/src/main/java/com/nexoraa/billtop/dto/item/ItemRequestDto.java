package com.nexoraa.billtop.dto.item;

import com.nexoraa.billtop.constants.ValidationMessage;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PastOrPresent;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
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
public class ItemRequestDto {

    @NotBlank(message = ValidationMessage.ITEM_NAME_REQUIRED)
    @Size(min = 2, max = 200, message = ValidationMessage.ITEM_NAME_INVALID)
    private String itemName;

    @NotBlank(message = ValidationMessage.ITEM_CODE_REQUIRED)
    @Size(max = 50, message = ValidationMessage.ITEM_CODE_REQUIRED)
    private String itemCode;

    @Size(max = 80, message = ValidationMessage.ITEM_CODE_REQUIRED)
    private String sku;

    @Size(max = 30, message = ValidationMessage.ITEM_CODE_REQUIRED)
    private String hsnCode;

    @NotNull(message = ValidationMessage.ID_REQUIRED)
    private Long categoryId;

    private Long subCategoryId;

    @NotNull(message = ValidationMessage.ID_REQUIRED)
    private Long brandId;

    @NotNull(message = ValidationMessage.ID_REQUIRED)
    private Long baseUnitId;

    @DecimalMin(value = "0.0", message = ValidationMessage.PRICE_INVALID)
    private BigDecimal purchasePrice;

    @DecimalMin(value = "0.0", message = ValidationMessage.PRICE_INVALID)
    private BigDecimal purchasePriceWithTax;

    @DecimalMin(value = "0.0", message = ValidationMessage.PRICE_INVALID)
    private BigDecimal taxPercentage;

    @DecimalMin(value = "0.0", message = ValidationMessage.PRICE_INVALID)
    private BigDecimal salePrice;

    @DecimalMin(value = "0.0", message = ValidationMessage.PRICE_INVALID)
    private BigDecimal wholesalePrice;

    @NotNull(message = ValidationMessage.MRP_REQUIRED)
    @DecimalMin(value = "0.0", message = ValidationMessage.PRICE_INVALID)
    private BigDecimal mrp;

    @DecimalMin(value = "0.0", message = ValidationMessage.PRICE_INVALID)
    private BigDecimal msp;

    @DecimalMin(value = "0.0", message = ValidationMessage.PRICE_INVALID)
    private BigDecimal discountPercentage;

    @DecimalMin(value = "0.0", message = ValidationMessage.PRICE_INVALID)
    private BigDecimal profitMargin;

    @NotBlank(message = ValidationMessage.BATCH_NO_REQUIRED)
    @Size(max = 80, message = ValidationMessage.BATCH_NO_REQUIRED)
    private String batchNo;

    @NotNull(message = ValidationMessage.MANUFACTURE_DATE_REQUIRED)
    @PastOrPresent(message = ValidationMessage.MANUFACTURE_DATE_REQUIRED)
    private LocalDate manufacturingDate;

    @NotNull(message = ValidationMessage.EXPIRY_DATE_REQUIRED)
    private LocalDate expiryDate;

    @NotNull(message = ValidationMessage.QUANTITY_INVALID)
    @Positive(message = ValidationMessage.QUANTITY_INVALID)
    private BigDecimal openingQuantity;

    @NotNull(message = ValidationMessage.MINIMUM_STOCK_INVALID)
    @Positive(message = ValidationMessage.MINIMUM_STOCK_INVALID)
    private BigDecimal minimumStock;

    @NotNull(message = ValidationMessage.ID_REQUIRED)
    private Long warehouseId;

    @Size(max = 500, message = ValidationMessage.DESCRIPTION_INVALID)
    private String description;
}
