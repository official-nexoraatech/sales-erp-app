package com.nexoraa.billtop.dto.report;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class BankStatementEntryResponseDto {

    private LocalDate date;
    private String description;
    private BigDecimal withdrawalAmount;
    private BigDecimal depositAmount;
    private BigDecimal balance;
}
