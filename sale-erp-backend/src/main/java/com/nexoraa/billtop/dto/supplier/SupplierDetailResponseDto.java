package com.nexoraa.billtop.dto.supplier;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SupplierDetailResponseDto {

    private Long id;
    private String supplierCode;
    private String firstName;
    private String lastName;
    private String mobile;
    private String email;
    private String gstNumber;
    private BigDecimal creditLimit;
    private BigDecimal openingBalance;
    private BigDecimal currentBalance;
}
