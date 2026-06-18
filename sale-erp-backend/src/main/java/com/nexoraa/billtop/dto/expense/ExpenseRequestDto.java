package com.nexoraa.billtop.dto.expense;

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

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ExpenseRequestDto {

    @NotNull(message = ValidationMessage.ID_REQUIRED)
    private Long expenseCategoryId;

    @NotNull(message = ValidationMessage.DATE_REQUIRED)
    private LocalDate expenseDate;

    @NotNull(message = ValidationMessage.PRICE_INVALID)
    @DecimalMin(value = "0.0", inclusive = false, message = ValidationMessage.PRICE_INVALID)
    private BigDecimal amount;

    @NotNull(message = ValidationMessage.ID_REQUIRED)
    private Long paymentMethodId;

    @Size(max = 500, message = ValidationMessage.DESCRIPTION_INVALID)
    private String notes;
}
