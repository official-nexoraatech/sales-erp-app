package com.nexoraa.billtop.dto.dashboard;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DashboardSummaryResponseDto {

    private BigDecimal todaySales;
    private BigDecimal todayPurchase;
    private BigDecimal todayExpense;
    private BigDecimal todayCollection;
    private BigDecimal cashInHand;
    private BigDecimal bankBalance;
    private BigDecimal stockValue;
    private long totalCustomers;
    private long totalSuppliers;
    private long lowStockItems;
    private long pendingSaleOrders;
    private long completedSaleOrders;
    private BigDecimal paymentReceivables;
    private BigDecimal paymentPayables;
    private long pendingPurchaseOrders;
    private long completedPurchaseOrders;
    private BigDecimal totalExpense;
}
