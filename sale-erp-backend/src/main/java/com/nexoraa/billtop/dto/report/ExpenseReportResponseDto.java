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
public class ExpenseReportResponseDto {

    private LocalDate date;
    private String expenseCode;
    private String category;
    private String paymentType;
    private BigDecimal paidAmount;
}
