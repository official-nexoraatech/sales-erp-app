package com.nexoraa.billtop.dto.payment;

import com.nexoraa.billtop.constants.ValidationMessage;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PaymentOutRequestDto {

    @NotNull(message = ValidationMessage.ID_REQUIRED)
    private Long supplierId;

    @NotNull(message = ValidationMessage.DATE_REQUIRED)
    private LocalDate paymentDate;

    @NotNull(message = ValidationMessage.ID_REQUIRED)
    private Long paymentMethodId;

    @Size(max = 100, message = ValidationMessage.DESCRIPTION_INVALID)
    private String referenceNo;

    @NotNull(message = ValidationMessage.PRICE_INVALID)
    @DecimalMin(value = "0.0", inclusive = false, message = ValidationMessage.PRICE_INVALID)
    private BigDecimal amount;

    @Size(max = 500, message = ValidationMessage.DESCRIPTION_INVALID)
    private String notes;

    private List<Long> purchaseIds;
}
