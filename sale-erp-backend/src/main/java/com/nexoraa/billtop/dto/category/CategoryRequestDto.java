package com.nexoraa.billtop.dto.category;

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
public class CategoryRequestDto {

    @NotBlank(message = ValidationMessage.NAME_REQUIRED)
    @Size(min = 2, max = 100, message = ValidationMessage.NAME_INVALID)
    private String name;

    @Size(max = 500, message = ValidationMessage.DESCRIPTION_INVALID)
    private String description;
}
