package com.nexoraa.billtop.dto.customer;

import com.nexoraa.billtop.constants.ValidationMessage;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
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
public class CustomerAddressRequestDto {

    @NotBlank(message = ValidationMessage.ADDRESS_LINE_REQUIRED)
    @Size(max = 250, message = ValidationMessage.ADDRESS_LINE_REQUIRED)
    private String addressLine1;

    @Size(max = 250, message = ValidationMessage.ADDRESS_LINE_REQUIRED)
    private String addressLine2;

    @NotBlank(message = ValidationMessage.CITY_REQUIRED)
    @Size(max = 100, message = ValidationMessage.CITY_REQUIRED)
    private String city;

    @NotNull(message = ValidationMessage.ID_REQUIRED)
    private Long stateId;

    @NotNull(message = ValidationMessage.ID_REQUIRED)
    private Long countryId;

    @Pattern(regexp = "^[0-9]{5,10}$", message = ValidationMessage.PINCODE_INVALID)
    private String pincode;
}
