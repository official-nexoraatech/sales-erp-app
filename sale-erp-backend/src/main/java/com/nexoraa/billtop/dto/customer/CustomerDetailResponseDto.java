package com.nexoraa.billtop.dto.customer;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CustomerDetailResponseDto {

    private Long id;
    private String customerCode;
    private String companyName;
    private String firstName;
    private String lastName;
    private String email;
    private String phone;
    private String mobile;
    private String whatsappNo;
    private String gstNumber;
    private String panNumber;
    private BigDecimal creditLimit;
    private BigDecimal openingBalance;
    private String openingBalanceType;
    private Boolean isWholesale;
    private BigDecimal currentBalance;
    private CustomerAddressResponseDto billingAddress;
    private CustomerAddressResponseDto shippingAddress;
}
