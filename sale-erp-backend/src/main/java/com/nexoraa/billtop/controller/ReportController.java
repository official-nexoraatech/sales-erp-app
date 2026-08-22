package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.report.CustomerDueResponseDto;
import com.nexoraa.billtop.dto.report.ExpenseReportResponseDto;
import com.nexoraa.billtop.dto.report.ExpiredItemResponseDto;
import com.nexoraa.billtop.dto.report.InventoryValuationResponseDto;
import com.nexoraa.billtop.dto.report.ItemInvoiceLineResponseDto;
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
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate toDate,
            @RequestParam(required = false) Long customerId
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.REPORT_RETRIEVED, reportService.getSalesReport(fromDate, toDate, customerId)));
    }

    @GetMapping("/purchases")
    public ResponseEntity<ApiResponseDto<SummaryReportResponseDto<?>>> getPurchaseReport(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fromDate,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate toDate,
            @RequestParam(required = false) Long supplierId
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.REPORT_RETRIEVED, reportService.getPurchaseReport(fromDate, toDate, supplierId)));
    }

    @GetMapping("/item-purchases")
    public ResponseEntity<ApiResponseDto<List<ItemInvoiceLineResponseDto>>> getItemPurchaseReport(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fromDate,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate toDate,
            @RequestParam(required = false) Long supplierId,
            @RequestParam(required = false) Long itemId,
            @RequestParam(required = false) Long brandId,
            @RequestParam(required = false) Long warehouseId
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.REPORT_RETRIEVED,
                reportService.getItemPurchaseReport(fromDate, toDate, supplierId, itemId, brandId, warehouseId)
        ));
    }

    @GetMapping("/item-sales")
    public ResponseEntity<ApiResponseDto<List<ItemInvoiceLineResponseDto>>> getItemSaleReport(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fromDate,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate toDate,
            @RequestParam(required = false) Long customerId,
            @RequestParam(required = false) Long itemId,
            @RequestParam(required = false) Long brandId,
            @RequestParam(required = false) Long warehouseId
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.REPORT_RETRIEVED,
                reportService.getItemSaleReport(fromDate, toDate, customerId, itemId, brandId, warehouseId)
        ));
    }

    @GetMapping("/stocks")
    public ResponseEntity<ApiResponseDto<List<StockReportResponseDto>>> getStockReport(
            @RequestParam(required = false) Long itemId,
            @RequestParam(required = false) Long brandId,
            @RequestParam(required = false) Long categoryId,
            @RequestParam(required = false) Long warehouseId
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.REPORT_RETRIEVED,
                reportService.getStockReport(itemId, brandId, categoryId, warehouseId)
        ));
    }

    @GetMapping("/low-stock")
    public ResponseEntity<ApiResponseDto<List<StockReportResponseDto>>> getLowStockReport(
            @RequestParam(required = false) Long categoryId,
            @RequestParam(required = false) Long itemId,
            @RequestParam(required = false) Long brandId
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.REPORT_RETRIEVED,
                reportService.getLowStockReport(categoryId, itemId, brandId)
        ));
    }

    @GetMapping("/profit-loss")
    public ResponseEntity<ApiResponseDto<ProfitLossReportResponseDto>> getProfitLoss(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fromDate,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate toDate
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.REPORT_RETRIEVED, reportService.getProfitLoss(fromDate, toDate)));
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
            @RequestParam(required = false) Long categoryId,
            @RequestParam(required = false) Long subCategoryId
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.REPORT_RETRIEVED,
                reportService.getExpenseReport(fromDate, toDate, categoryId, subCategoryId, null)
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
