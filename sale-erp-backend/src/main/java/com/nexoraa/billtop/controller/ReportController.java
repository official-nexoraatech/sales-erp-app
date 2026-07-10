package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.ledger.LedgerResponseDto;
import com.nexoraa.billtop.dto.report.BankStatementEntryResponseDto;
import com.nexoraa.billtop.dto.report.CustomerDueResponseDto;
import com.nexoraa.billtop.dto.report.DayBookEntryResponseDto;
import com.nexoraa.billtop.dto.report.ExpenseReportResponseDto;
import com.nexoraa.billtop.dto.report.ExpiredItemResponseDto;
import com.nexoraa.billtop.dto.report.GstReportResponseDto;
import com.nexoraa.billtop.dto.report.InventoryValuationResponseDto;
import com.nexoraa.billtop.dto.report.ItemTransactionResponseDto;
import com.nexoraa.billtop.dto.report.PaymentReportResponseDto;
import com.nexoraa.billtop.dto.report.ProfitLossReportResponseDto;
import com.nexoraa.billtop.dto.report.StockReportResponseDto;
import com.nexoraa.billtop.dto.report.SummaryReportResponseDto;
import com.nexoraa.billtop.dto.report.SupplierDueResponseDto;
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
    public ResponseEntity<ApiResponseDto<List<GstReportResponseDto>>> getGstReport(
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

    @GetMapping("/customer-dues")
    public ResponseEntity<ApiResponseDto<List<CustomerDueResponseDto>>> getCustomerDues(
            @RequestParam(required = false) @Positive Long customerId
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.REPORT_RETRIEVED, reportService.getCustomerDues(customerId)));
    }

    @GetMapping("/supplier-dues")
    public ResponseEntity<ApiResponseDto<List<SupplierDueResponseDto>>> getSupplierDues(
            @RequestParam(required = false) @Positive Long supplierId
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.REPORT_RETRIEVED, reportService.getSupplierDues(supplierId)));
    }

    @GetMapping("/purchase-payments")
    public ResponseEntity<ApiResponseDto<List<PaymentReportResponseDto>>> getPurchasePayments(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fromDate,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate toDate,
            @RequestParam(required = false) Long supplierId,
            @RequestParam(required = false) Long paymentMethodId
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.REPORT_RETRIEVED,
                reportService.getPurchasePayments(fromDate, toDate, supplierId, paymentMethodId)
        ));
    }

    @GetMapping("/sale-payments")
    public ResponseEntity<ApiResponseDto<List<PaymentReportResponseDto>>> getSalePayments(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fromDate,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate toDate,
            @RequestParam(required = false) Long customerId,
            @RequestParam(required = false) Long paymentMethodId
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.REPORT_RETRIEVED,
                reportService.getSalePayments(fromDate, toDate, customerId, paymentMethodId)
        ));
    }

    @GetMapping("/expense-items")
    public ResponseEntity<ApiResponseDto<List<ExpenseReportResponseDto>>> getExpenseItems(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fromDate,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate toDate,
            @RequestParam(required = false) Long categoryId
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.REPORT_RETRIEVED,
                reportService.getExpenseReport(fromDate, toDate, categoryId, null)
        ));
    }

    @GetMapping("/expense-payments")
    public ResponseEntity<ApiResponseDto<List<ExpenseReportResponseDto>>> getExpensePayments(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fromDate,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate toDate,
            @RequestParam(required = false) Long categoryId,
            @RequestParam(required = false) Long paymentMethodId
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.REPORT_RETRIEVED,
                reportService.getExpenseReport(fromDate, toDate, categoryId, paymentMethodId)
        ));
    }

    @GetMapping("/bank-statement")
    public ResponseEntity<ApiResponseDto<List<BankStatementEntryResponseDto>>> getBankStatement(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fromDate,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate toDate,
            @RequestParam(required = false) Long bankAccountId
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.REPORT_RETRIEVED,
                reportService.getBankStatement(fromDate, toDate, bankAccountId)
        ));
    }

    @GetMapping("/item-transactions/batch")
    public ResponseEntity<ApiResponseDto<List<ItemTransactionResponseDto>>> getItemTransactionsBatch(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fromDate,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate toDate,
            @RequestParam(required = false) Long itemId,
            @RequestParam(required = false) Long brandId,
            @RequestParam(required = false) String batchNo,
            @RequestParam(required = false) Long warehouseId
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.REPORT_RETRIEVED,
                reportService.getItemTransactionsBatch(fromDate, toDate, itemId, brandId, batchNo, warehouseId)
        ));
    }

    @GetMapping("/item-transactions/general")
    public ResponseEntity<ApiResponseDto<List<ItemTransactionResponseDto>>> getItemTransactionsGeneral(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fromDate,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate toDate,
            @RequestParam(required = false) Long itemId,
            @RequestParam(required = false) Long brandId,
            @RequestParam(required = false) Long warehouseId
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.REPORT_RETRIEVED,
                reportService.getItemTransactionsGeneral(fromDate, toDate, itemId, brandId, warehouseId)
        ));
    }

    @GetMapping("/item-transactions/serial")
    public ResponseEntity<ApiResponseDto<List<ItemTransactionResponseDto>>> getItemTransactionsSerial(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fromDate,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate toDate,
            @RequestParam(required = false) Long itemId,
            @RequestParam(required = false) Long brandId,
            @RequestParam(required = false) String serialImei,
            @RequestParam(required = false) Long warehouseId
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.REPORT_RETRIEVED,
                reportService.getItemTransactionsSerial(fromDate, toDate, itemId, brandId, serialImei, warehouseId)
        ));
    }

    @GetMapping("/expired-items")
    public ResponseEntity<ApiResponseDto<List<ExpiredItemResponseDto>>> getExpiredItems(
            @RequestParam(required = false) String filterType,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fromDate,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate toDate,
            @RequestParam(required = false) Long itemId,
            @RequestParam(required = false) Long brandId,
            @RequestParam(required = false) String batchNo,
            @RequestParam(required = false) Long warehouseId
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.REPORT_RETRIEVED,
                reportService.getExpiredItems(filterType, fromDate, toDate, itemId, brandId, batchNo, warehouseId)
        ));
    }
}
