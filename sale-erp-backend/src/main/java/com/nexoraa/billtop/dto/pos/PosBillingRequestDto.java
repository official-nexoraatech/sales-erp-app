package com.nexoraa.billtop.dto.pos;

import com.nexoraa.billtop.constants.ValidationMessage;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PosBillingRequestDto {

    @NotNull(message = ValidationMessage.ID_REQUIRED)
    private Long customerId;

    @NotNull(message = ValidationMessage.ID_REQUIRED)
    private Long warehouseId;

    @NotNull(message = ValidationMessage.ID_REQUIRED)
    private Long paymentMethodId;

    @Valid
    @NotEmpty(message = ValidationMessage.ITEMS_REQUIRED)
    private List<PosBillingItemRequestDto> items;
}
