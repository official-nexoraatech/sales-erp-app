package com.nexoraa.billtop.dto.warehouse;

import com.nexoraa.billtop.constants.ValidationMessage;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class WarehouseRequestDto {

    @NotBlank(message = ValidationMessage.NAME_REQUIRED)
    @Size(min = 2, max = 100, message = ValidationMessage.NAME_INVALID)
    private String name;

    @NotBlank(message = ValidationMessage.WAREHOUSE_CODE_REQUIRED)
    @Size(max = 50, message = ValidationMessage.WAREHOUSE_CODE_INVALID)
    private String warehouseCode;

    @Size(max = 500, message = ValidationMessage.DESCRIPTION_INVALID)
    private String description;

    @Size(max = 500, message = ValidationMessage.ADDRESS_REQUIRED)
    private String address;
}
