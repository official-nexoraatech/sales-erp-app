package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.ledger.LedgerResponseDto;
import com.nexoraa.billtop.dto.report.DayBookEntryResponseDto;
import com.nexoraa.billtop.dto.report.GstReportResponseDto;
import com.nexoraa.billtop.dto.report.InventoryValuationResponseDto;
import com.nexoraa.billtop.dto.report.ProfitLossReportResponseDto;
import com.nexoraa.billtop.dto.report.StockReportResponseDto;
import com.nexoraa.billtop.dto.report.SummaryReportResponseDto;
import com.nexoraa.billtop.dto.report.TopSellingItemResponseDto;

import java.time.LocalDate;
import java.util.List;

public interface ReportService {

    SummaryReportResponseDto<?> getSalesReport(LocalDate fromDate, LocalDate toDate);

    SummaryReportResponseDto<?> getPurchaseReport(LocalDate fromDate, LocalDate toDate);

    List<StockReportResponseDto> getStockReport();

    List<StockReportResponseDto> getLowStockReport();

    LedgerResponseDto getCustomerLedger(Long customerId);

    LedgerResponseDto getSupplierLedger(Long supplierId);

    ProfitLossReportResponseDto getProfitLoss(LocalDate fromDate, LocalDate toDate);

    GstReportResponseDto getGstReport(LocalDate fromDate, LocalDate toDate);

    InventoryValuationResponseDto getInventoryValuation();

    List<TopSellingItemResponseDto> getTopSellingItems(LocalDate fromDate, LocalDate toDate);

    List<DayBookEntryResponseDto> getDayBook(LocalDate date);
}
