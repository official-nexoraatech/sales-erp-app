package com.nexoraa.billtop.dto.report;

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
public class SummaryReportResponseDto<T> {

    private BigDecimal totalSales;
    private BigDecimal totalPurchase;
    private BigDecimal totalExpense;
    private long invoiceCount;
    private long purchaseCount;
    private List<T> records;
}
