package com.nexoraa.billtop.dto.auth;

import com.nexoraa.billtop.constants.ValidationMessage;
import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class LoginRequestDto {

    @NotBlank(message = ValidationMessage.USERNAME_REQUIRED)
    private String userName;

    @NotBlank(message = ValidationMessage.PASSWORD_REQUIRED)
    private String password;
}
