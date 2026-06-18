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
public class CustomerListResponseDto {

    private Long id;
    private String customerCode;
    private String customerName;
    private String mobile;
    private BigDecimal balance;
}
