package com.nexoraa.billtop.dto.user;

import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.constants.ValidationMessage;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CreateUserRequestDto {

    @NotBlank(message = ValidationMessage.FIRST_NAME_REQUIRED)
    @Size(min = 2, max = 100, message = ValidationMessage.FIRST_NAME_INVALID)
    private String firstName;

    @NotBlank(message = ValidationMessage.LAST_NAME_REQUIRED)
    @Size(min = 2, max = 100, message = ValidationMessage.LAST_NAME_INVALID)
    private String lastName;

    @NotBlank(message = ValidationMessage.USERNAME_REQUIRED)
    @Size(min = 3, max = 50, message = ValidationMessage.USERNAME_INVALID)
    private String userName;

    @NotBlank(message = ValidationMessage.EMAIL_REQUIRED)
    @Email(message = ValidationMessage.EMAIL_INVALID)
    @Size(max = 150, message = ValidationMessage.EMAIL_INVALID)
    private String email;

    @Size(max = 20, message = ValidationMessage.MOBILE_INVALID)
    private String mobileNo;

    @NotNull(message = ValidationMessage.ID_REQUIRED)
    private Long roleId;

    @NotNull(message = ValidationMessage.ID_REQUIRED)
    private Long organizationId;

    private String password;

    private Status status;
}

