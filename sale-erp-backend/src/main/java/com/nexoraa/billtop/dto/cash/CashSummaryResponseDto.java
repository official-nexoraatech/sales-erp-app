package com.nexoraa.billtop.dto.cash;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CashSummaryResponseDto {

    private BigDecimal openingBalance;
    private BigDecimal received;
    private BigDecimal paid;
    private BigDecimal currentBalance;
}
