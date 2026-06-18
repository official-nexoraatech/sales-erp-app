package com.nexoraa.billtop.dto.ledger;

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
public class LedgerTransactionResponseDto {

    private LocalDate date;
    private String type;
    private String referenceNo;
    private BigDecimal debit;
    private BigDecimal credit;
    private BigDecimal balance;
}
