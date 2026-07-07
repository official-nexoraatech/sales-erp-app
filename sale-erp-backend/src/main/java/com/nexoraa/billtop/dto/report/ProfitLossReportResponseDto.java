package com.nexoraa.billtop.dto.report;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ProfitLossReportResponseDto {

    private BigDecimal totalSales;
    private BigDecimal totalPurchase;
    private BigDecimal totalExpense;
    private BigDecimal grossProfit;
    private BigDecimal netProfit;

    private BigDecimal saleWithoutTax;
    private BigDecimal saleReturnWithoutTax;
    private BigDecimal purchaseWithoutTax;
    private BigDecimal purchaseReturnWithoutTax;
    private BigDecimal expenseWithoutTax;
    private BigDecimal shippingCharge;
    private BigDecimal netSummary;
}
