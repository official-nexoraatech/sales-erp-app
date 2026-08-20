package com.nexoraa.billtop.dto.email;

import com.nexoraa.billtop.constants.ValidationMessage;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ConnectEmailAccountRequestDto {

    @NotBlank(message = ValidationMessage.EMAIL_REQUIRED)
    @Email(message = ValidationMessage.EMAIL_INVALID)
    private String fromAddress;

    @NotBlank(message = "SMTP host is required")
    private String smtpHost;

    @NotNull(message = "SMTP port is required")
    @Positive(message = "SMTP port must be positive")
    private Integer smtpPort;

    @NotBlank(message = "SMTP username is required")
    private String smtpUsername;

    @NotBlank(message = "SMTP password is required")
    private String smtpPassword;

    @Builder.Default
    private boolean useStarttls = true;

    @Builder.Default
    private boolean useSsl = false;
}
