package com.nexoraa.billtop.dto.sales;

import com.nexoraa.billtop.constants.ValidationMessage;
import com.nexoraa.billtop.dto.returning.ReturnItemRequestDto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SalesReturnRequestDto {

    @NotNull(message = ValidationMessage.ID_REQUIRED)
    private Long saleId;

    @NotNull(message = ValidationMessage.ID_REQUIRED)
    private Long customerId;

    @NotNull(message = ValidationMessage.DATE_REQUIRED)
    private LocalDate returnDate;

    @Size(max = 500, message = ValidationMessage.DESCRIPTION_INVALID)
    private String reason;

    @Valid
    @NotEmpty(message = ValidationMessage.ITEMS_REQUIRED)
    private List<ReturnItemRequestDto> items;
}
