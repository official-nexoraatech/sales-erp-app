package com.nexoraa.billtop.dto.user;

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
public class ChangePasswordRequestDto {

    @NotBlank(message = ValidationMessage.PASSWORD_REQUIRED)
    private String currentPassword;

    @NotBlank(message = ValidationMessage.PASSWORD_REQUIRED)
    @Size(min = 6, message = ValidationMessage.PASSWORD_INVALID)
    private String newPassword;
}
