package com.nexoraa.billtop.dto.purchase;

import com.nexoraa.billtop.constants.ValidationMessage;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
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
public class PurchaseItemRequestDto {

    @NotNull(message = ValidationMessage.ID_REQUIRED)
    private Long itemId;

    @NotBlank(message = ValidationMessage.BATCH_NO_REQUIRED)
    @Size(max = 80, message = ValidationMessage.BATCH_NO_REQUIRED)
    private String batchNo;

    private LocalDate manufacturingDate;

    private LocalDate expiryDate;

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
