package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.ledger.LedgerResponseDto;
import com.nexoraa.billtop.dto.report.DayBookEntryResponseDto;
import com.nexoraa.billtop.dto.report.GstReportResponseDto;
import com.nexoraa.billtop.dto.report.InventoryValuationResponseDto;
import com.nexoraa.billtop.dto.report.ProfitLossReportResponseDto;
import com.nexoraa.billtop.dto.report.StockReportResponseDto;
import com.nexoraa.billtop.dto.report.SummaryReportResponseDto;
import com.nexoraa.billtop.dto.report.TopSellingItemResponseDto;
import com.nexoraa.billtop.service.ReportService;
import jakarta.validation.constraints.Positive;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;

@Validated
@RestController
@RequestMapping("/api/v1/reports")
public class ReportController {

    private final ReportService reportService;

    public ReportController(ReportService reportService) {
        this.reportService = reportService;
    }

    @GetMapping("/sales")
    public ResponseEntity<ApiResponseDto<SummaryReportResponseDto<?>>> getSalesReport(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fromDate,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate toDate
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.REPORT_RETRIEVED, reportService.getSalesReport(fromDate, toDate)));
    }

    @GetMapping("/purchases")
    public ResponseEntity<ApiResponseDto<SummaryReportResponseDto<?>>> getPurchaseReport(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fromDate,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate toDate
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.REPORT_RETRIEVED, reportService.getPurchaseReport(fromDate, toDate)));
    }

    @GetMapping("/stocks")
    public ResponseEntity<ApiResponseDto<List<StockReportResponseDto>>> getStockReport() {
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.REPORT_RETRIEVED, reportService.getStockReport()));
    }

    @GetMapping("/low-stock")
    public ResponseEntity<ApiResponseDto<List<StockReportResponseDto>>> getLowStockReport() {
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.REPORT_RETRIEVED, reportService.getLowStockReport()));
    }

    @GetMapping("/customer-ledger/{customerId}")
    public ResponseEntity<ApiResponseDto<LedgerResponseDto>> getCustomerLedger(@PathVariable @Positive Long customerId) {
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.REPORT_RETRIEVED, reportService.getCustomerLedger(customerId)));
    }

    @GetMapping("/supplier-ledger/{supplierId}")
    public ResponseEntity<ApiResponseDto<LedgerResponseDto>> getSupplierLedger(@PathVariable @Positive Long supplierId) {
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.REPORT_RETRIEVED, reportService.getSupplierLedger(supplierId)));
    }

    @GetMapping("/profit-loss")
    public ResponseEntity<ApiResponseDto<ProfitLossReportResponseDto>> getProfitLoss(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fromDate,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate toDate
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.REPORT_RETRIEVED, reportService.getProfitLoss(fromDate, toDate)));
    }

    @GetMapping("/gst")
    public ResponseEntity<ApiResponseDto<GstReportResponseDto>> getGstReport(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fromDate,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate toDate
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.REPORT_RETRIEVED, reportService.getGstReport(fromDate, toDate)));
    }

    @GetMapping("/inventory-valuation")
    public ResponseEntity<ApiResponseDto<InventoryValuationResponseDto>> getInventoryValuation() {
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.REPORT_RETRIEVED, reportService.getInventoryValuation()));
    }

    @GetMapping("/top-selling-items")
    public ResponseEntity<ApiResponseDto<List<TopSellingItemResponseDto>>> getTopSellingItems(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fromDate,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate toDate
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.REPORT_RETRIEVED, reportService.getTopSellingItems(fromDate, toDate)));
    }

    @GetMapping("/day-book")
    public ResponseEntity<ApiResponseDto<List<DayBookEntryResponseDto>>> getDayBook(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.REPORT_RETRIEVED, reportService.getDayBook(date)));
    }
}
