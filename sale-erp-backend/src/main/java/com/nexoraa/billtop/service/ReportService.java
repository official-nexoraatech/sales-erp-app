package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.ledger.LedgerResponseDto;
import com.nexoraa.billtop.dto.report.BankStatementEntryResponseDto;
import com.nexoraa.billtop.dto.report.CustomerDueResponseDto;
import com.nexoraa.billtop.dto.report.DayBookEntryResponseDto;
import com.nexoraa.billtop.dto.report.ExpenseReportResponseDto;
import com.nexoraa.billtop.dto.report.ExpiredItemResponseDto;
import com.nexoraa.billtop.dto.report.GstReportResponseDto;
import com.nexoraa.billtop.dto.report.InventoryValuationResponseDto;
import com.nexoraa.billtop.dto.report.ItemInvoiceLineResponseDto;
import com.nexoraa.billtop.dto.report.ItemTransactionResponseDto;
import com.nexoraa.billtop.dto.report.PaymentReportResponseDto;
import com.nexoraa.billtop.dto.report.ProfitLossReportResponseDto;
import com.nexoraa.billtop.dto.report.StockReportResponseDto;
import com.nexoraa.billtop.dto.report.SummaryReportResponseDto;
import com.nexoraa.billtop.dto.report.SupplierDueResponseDto;
import com.nexoraa.billtop.dto.report.TopSellingItemResponseDto;

import java.time.LocalDate;
import java.util.List;

public interface ReportService {

    SummaryReportResponseDto<?> getSalesReport(LocalDate fromDate, LocalDate toDate, Long customerId);

    SummaryReportResponseDto<?> getPurchaseReport(LocalDate fromDate, LocalDate toDate, Long supplierId);

    List<ItemInvoiceLineResponseDto> getItemPurchaseReport(
            LocalDate fromDate, LocalDate toDate, Long supplierId, Long itemId, Long brandId, Long warehouseId
    );

    List<ItemInvoiceLineResponseDto> getItemSaleReport(
            LocalDate fromDate, LocalDate toDate, Long customerId, Long itemId, Long brandId, Long warehouseId
    );

    List<StockReportResponseDto> getStockReport();

    List<StockReportResponseDto> getLowStockReport();

    /**
     * Super Admin lookups: {@code organizationId} identifies the organization explicitly
     * rather than the caller's token, so these bypass {@code CurrentOrganizationService}.
     */
    List<StockReportResponseDto> getStockReportForOrganization(Long organizationId);

    List<StockReportResponseDto> getLowStockReportForOrganization(Long organizationId);

    LedgerResponseDto getCustomerLedger(Long customerId);

    LedgerResponseDto getSupplierLedger(Long supplierId);

    ProfitLossReportResponseDto getProfitLoss(LocalDate fromDate, LocalDate toDate);

    List<GstReportResponseDto> getGstReport(LocalDate fromDate, LocalDate toDate);

    InventoryValuationResponseDto getInventoryValuation();

    List<TopSellingItemResponseDto> getTopSellingItems(LocalDate fromDate, LocalDate toDate);

    List<DayBookEntryResponseDto> getDayBook(LocalDate date);

    List<CustomerDueResponseDto> getCustomerDues(Long customerId);

    List<SupplierDueResponseDto> getSupplierDues(Long supplierId);

    List<PaymentReportResponseDto> getPurchasePayments(LocalDate fromDate, LocalDate toDate, Long supplierId, Long paymentMethodId);

    List<PaymentReportResponseDto> getSalePayments(LocalDate fromDate, LocalDate toDate, Long customerId, Long paymentMethodId);

    List<ExpenseReportResponseDto> getExpenseReport(LocalDate fromDate, LocalDate toDate, Long categoryId, Long paymentMethodId);

    List<BankStatementEntryResponseDto> getBankStatement(LocalDate fromDate, LocalDate toDate, Long bankAccountId);

    List<ItemTransactionResponseDto> getItemTransactionsBatch(
            LocalDate fromDate, LocalDate toDate, Long itemId, Long brandId, String batchNo, Long warehouseId
    );

    List<ItemTransactionResponseDto> getItemTransactionsGeneral(
            LocalDate fromDate, LocalDate toDate, Long itemId, Long brandId, Long warehouseId
    );

    List<ItemTransactionResponseDto> getItemTransactionsSerial(
            LocalDate fromDate, LocalDate toDate, Long itemId, Long brandId, String serialImei, Long warehouseId
    );

    List<ExpiredItemResponseDto> getExpiredItems(
            String filterType, LocalDate fromDate, LocalDate toDate, Long itemId, Long brandId, String batchNo, Long warehouseId
    );
}
