package com.nexoraa.billtop.dto.ledger;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class LedgerResponseDto {

    private BigDecimal openingBalance;
    private List<LedgerTransactionResponseDto> transactions;
}
