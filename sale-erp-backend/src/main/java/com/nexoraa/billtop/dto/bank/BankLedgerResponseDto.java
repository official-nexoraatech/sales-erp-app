package com.nexoraa.billtop.dto.bank;

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
public class BankLedgerResponseDto {

    private BigDecimal currentBalance;
    private List<BankTransactionResponseDto> transactions;
}
