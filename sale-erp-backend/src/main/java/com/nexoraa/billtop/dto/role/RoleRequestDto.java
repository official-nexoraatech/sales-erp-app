package com.nexoraa.billtop.dto.role;

import com.nexoraa.billtop.enums.Status;
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
public class RoleRequestDto {

    @NotBlank(message = ValidationMessage.ROLE_NAME_REQUIRED)
    @Size(min = 2, max = 100, message = ValidationMessage.ROLE_NAME_INVALID)
    private String name;

    private Status status;
}

