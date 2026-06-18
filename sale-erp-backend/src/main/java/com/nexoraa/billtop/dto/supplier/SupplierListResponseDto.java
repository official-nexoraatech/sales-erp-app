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
public class SupplierListResponseDto {

    private Long id;
    private String supplierCode;
    private String supplierName;
    private String mobile;
    private BigDecimal balance;
}
