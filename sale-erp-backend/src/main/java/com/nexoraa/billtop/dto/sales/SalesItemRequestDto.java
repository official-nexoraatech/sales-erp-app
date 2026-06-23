package com.nexoraa.billtop.dto.sales;

import com.nexoraa.billtop.constants.ValidationMessage;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SalesItemRequestDto {

    @NotNull(message = ValidationMessage.ID_REQUIRED)
    private Long itemId;

    @NotNull(message = ValidationMessage.QUANTITY_REQUIRED)
    @Positive(message = ValidationMessage.QUANTITY_INVALID)
    private BigDecimal quantity;

    @NotNull(message = ValidationMessage.PRICE_INVALID)
    @DecimalMin(value = "0.0", inclusive = false, message = ValidationMessage.PRICE_INVALID)
    private BigDecimal unitPrice;

    @DecimalMin(value = "0.0", message = ValidationMessage.PRICE_INVALID)
    private BigDecimal discountPercent;

    @DecimalMin(value = "0.0", message = ValidationMessage.PRICE_INVALID)
    private BigDecimal taxPercent;
}
