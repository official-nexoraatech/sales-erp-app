package com.nexoraa.billtop.dto.purchase;

import com.nexoraa.billtop.constants.ValidationMessage;
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
public class PurchaseRequestDto {

    @NotNull(message = ValidationMessage.ID_REQUIRED)
    private Long supplierId;

    @NotNull(message = ValidationMessage.DATE_REQUIRED)
    private LocalDate purchaseDate;

    @Size(max = 100, message = ValidationMessage.DESCRIPTION_INVALID)
    private String referenceNo;

    @NotNull(message = ValidationMessage.ID_REQUIRED)
    private Long warehouseId;

    private Long carrierId;

    private Long stateId;

    @Size(max = 500, message = ValidationMessage.DESCRIPTION_INVALID)
    private String notes;

    @Valid
    @NotEmpty(message = ValidationMessage.ITEMS_REQUIRED)
    private List<PurchaseItemRequestDto> items;
}
