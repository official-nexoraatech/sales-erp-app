package com.nexoraa.billtop.dto.stock;

import com.nexoraa.billtop.constants.ValidationMessage;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class StockAdjustmentItemRequestDto {

    @NotNull(message = ValidationMessage.ID_REQUIRED)
    private Long itemId;

    @NotNull(message = ValidationMessage.QUANTITY_REQUIRED)
    @DecimalMin(value = "0.0", message = ValidationMessage.QUANTITY_INVALID)
    private BigDecimal currentQty;

    @NotNull(message = ValidationMessage.QUANTITY_REQUIRED)
    @DecimalMin(value = "0.0", message = ValidationMessage.QUANTITY_INVALID)
    private BigDecimal actualQty;
}
