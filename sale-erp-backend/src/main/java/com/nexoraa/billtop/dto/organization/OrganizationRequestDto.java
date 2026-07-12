package com.nexoraa.billtop.dto.organization;

import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.constants.ValidationMessage;
import jakarta.validation.Valid;
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
public class OrganizationRequestDto {

    @NotBlank(message = ValidationMessage.NAME_REQUIRED)
    @Size(min = 2, max = 150, message = ValidationMessage.NAME_INVALID)
    private String name;

    @Size(max = 500, message = ValidationMessage.DESCRIPTION_INVALID)
    private String description;

    @Size(max = 500, message = ValidationMessage.URL_INVALID)
    private String logoUrl;

    @Size(max = 20, message = ValidationMessage.MOBILE_INVALID)
    private String phone;

    @Pattern(regexp = "^$|^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$", message = ValidationMessage.GST_NUMBER_INVALID)
    private String gstNumber;

    @Valid
    private OrganizationAddressRequestDto address;

    private Status status;

    private Boolean isSubscribed;
}

