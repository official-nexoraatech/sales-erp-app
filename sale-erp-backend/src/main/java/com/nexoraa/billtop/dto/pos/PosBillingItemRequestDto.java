package com.nexoraa.billtop.dto.pos;

import com.nexoraa.billtop.constants.ValidationMessage;
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
public class PosBillingItemRequestDto {

    @NotNull(message = ValidationMessage.ID_REQUIRED)
    private Long itemId;

    @NotNull(message = ValidationMessage.QUANTITY_REQUIRED)
    @Positive(message = ValidationMessage.QUANTITY_INVALID)
    private BigDecimal quantity;
}
