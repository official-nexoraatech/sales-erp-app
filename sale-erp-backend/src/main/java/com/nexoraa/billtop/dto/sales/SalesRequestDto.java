package com.nexoraa.billtop.dto.sales;

import com.nexoraa.billtop.constants.ValidationMessage;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
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
public class SalesRequestDto {

    @NotNull(message = ValidationMessage.ID_REQUIRED)
    private Long customerId;

    @NotNull(message = ValidationMessage.DATE_REQUIRED)
    private LocalDate invoiceDate;

    @NotNull(message = ValidationMessage.ID_REQUIRED)
    private Long warehouseId;

    private Long stateId;

    private Long salesPersonId;

    private BigDecimal roundOff;

    @Size(max = 500, message = ValidationMessage.DESCRIPTION_INVALID)
    private String notes;

    @Valid
    @NotEmpty(message = ValidationMessage.ITEMS_REQUIRED)
    private List<SalesItemRequestDto> items;
}
