package com.nexoraa.billtop.dto.sms;

import com.nexoraa.billtop.constants.ValidationMessage;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SmsSendRequestDto {

    @NotEmpty(message = ValidationMessage.MOBILE_NUMBERS_REQUIRED)
    private List<@NotBlank(message = ValidationMessage.MOBILE_REQUIRED) String> mobileNumbers;

    @NotBlank(message = ValidationMessage.MESSAGE_REQUIRED)
    private String message;
}
