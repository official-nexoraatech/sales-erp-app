package com.nexoraa.billtop.dto.unit;

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
public class UnitRequestDto {

    @NotBlank(message = ValidationMessage.NAME_REQUIRED)
    @Size(min = 2, max = 100, message = ValidationMessage.NAME_INVALID)
    private String name;

    @NotBlank(message = ValidationMessage.SHORT_NAME_REQUIRED)
    @Size(max = 20, message = ValidationMessage.SHORT_NAME_INVALID)
    private String shortName;
}
