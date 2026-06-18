package com.nexoraa.billtop.dto.carrier;

import com.nexoraa.billtop.constants.ValidationMessage;
import com.nexoraa.billtop.enums.Status;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CarrierRequestDto {

    @NotBlank(message = ValidationMessage.NAME_REQUIRED)
    @Size(min = 2, max = 100, message = ValidationMessage.NAME_INVALID)
    private String name;

    @Email(message = ValidationMessage.EMAIL_INVALID)
    @Size(max = 150, message = ValidationMessage.EMAIL_INVALID)
    private String email;

    @Pattern(regexp = "^$|^[0-9]{10,15}$", message = ValidationMessage.MOBILE_INVALID)
    private String mobile;

    @Pattern(regexp = "^$|^[0-9]{10,15}$", message = ValidationMessage.MOBILE_INVALID)
    private String whatsappNo;

    private Status status;

    @Size(max = 500, message = ValidationMessage.ADDRESS_INVALID)
    private String address;

    @Size(max = 500, message = ValidationMessage.DESCRIPTION_INVALID)
    private String note;
}
