package com.nexoraa.billtop.dto.customer;

import com.nexoraa.billtop.constants.ValidationMessage;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CustomerRequestDto {

    @Size(max = 150, message = ValidationMessage.COMPANY_NAME_INVALID)
    private String companyName;

    @NotBlank(message = ValidationMessage.FIRST_NAME_REQUIRED)
    @Size(min = 2, max = 100, message = ValidationMessage.FIRST_NAME_INVALID)
    private String firstName;

    @NotBlank(message = ValidationMessage.LAST_NAME_REQUIRED)
    @Size(min = 2, max = 100, message = ValidationMessage.LAST_NAME_INVALID)
    private String lastName;

    @Email(message = ValidationMessage.EMAIL_INVALID)
    @Size(max = 150, message = ValidationMessage.EMAIL_INVALID)
    private String email;

    @Size(max = 20, message = ValidationMessage.MOBILE_INVALID)
    private String phone;

    @NotBlank(message = ValidationMessage.MOBILE_REQUIRED)
    @Pattern(regexp = "^[0-9]{10,15}$", message = ValidationMessage.MOBILE_INVALID)
    private String mobile;

    @Pattern(regexp = "^[0-9]{10,15}$", message = ValidationMessage.MOBILE_INVALID)
    private String whatsappNo;

    @Pattern(regexp = "^$|^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$", message = ValidationMessage.GST_NUMBER_INVALID)
    private String gstNumber;

    @Pattern(regexp = "^$|^[A-Z]{5}[0-9]{4}[A-Z]$", message = ValidationMessage.PAN_NUMBER_INVALID)
    private String panNumber;

    @DecimalMin(value = "0.0", message = ValidationMessage.PRICE_INVALID)
    private BigDecimal creditLimit;

    @DecimalMin(value = "0.0", message = ValidationMessage.PRICE_INVALID)
    private BigDecimal openingBalance;

    @Pattern(regexp = "^$|^(RECEIVABLE|PAYABLE)$", message = ValidationMessage.OPENING_BALANCE_TYPE_INVALID)
    private String openingBalanceType;

    private Boolean isWholesale;

    @Valid
    private CustomerAddressRequestDto billingAddress;

    @Valid
    private CustomerAddressRequestDto shippingAddress;
}
