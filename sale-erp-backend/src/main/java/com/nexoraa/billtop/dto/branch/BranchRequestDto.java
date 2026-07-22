package com.nexoraa.billtop.dto.branch;

import com.nexoraa.billtop.constants.ValidationMessage;
import jakarta.validation.constraints.Email;
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
public class BranchRequestDto {

    @NotBlank(message = ValidationMessage.BRANCH_CODE_REQUIRED)
    @Size(max = 50, message = ValidationMessage.BRANCH_CODE_INVALID)
    private String branchCode;

    @NotBlank(message = ValidationMessage.BRANCH_NAME_REQUIRED)
    @Size(min = 2, max = 150, message = ValidationMessage.BRANCH_NAME_INVALID)
    private String branchName;

    @Email(message = ValidationMessage.EMAIL_INVALID)
    @Size(max = 150)
    private String email;

    @Size(max = 20, message = ValidationMessage.MOBILE_INVALID)
    private String phone;

    @Size(max = 500, message = ValidationMessage.ADDRESS_INVALID)
    private String address;

    @Size(max = 100, message = ValidationMessage.CITY_REQUIRED)
    private String city;

    @Size(max = 100)
    private String state;

    @Size(max = 100)
    private String country;

    @Size(max = 20, message = ValidationMessage.PINCODE_INVALID)
    private String pincode;

    @Size(max = 30, message = ValidationMessage.GST_NUMBER_INVALID)
    private String gstNumber;
}
