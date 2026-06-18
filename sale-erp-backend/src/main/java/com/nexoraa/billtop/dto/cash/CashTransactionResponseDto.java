package com.nexoraa.billtop.dto.cash;

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
public class CashTransactionResponseDto {

    private LocalDate date;
    private String type;
    private BigDecimal amount;
}
