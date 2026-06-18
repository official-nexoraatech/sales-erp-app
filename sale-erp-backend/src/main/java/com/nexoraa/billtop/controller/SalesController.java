package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.sales.SalesDetailResponseDto;
import com.nexoraa.billtop.dto.sales.SalesInvoiceResponseDto;
import com.nexoraa.billtop.dto.sales.SalesListResponseDto;
import com.nexoraa.billtop.dto.sales.SalesRequestDto;
import com.nexoraa.billtop.service.SalesService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Positive;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;

@Validated
@RestController
@RequestMapping("/api/v1/sales")
public class SalesController {

    private final SalesService salesService;

    public SalesController(SalesService salesService) {
        this.salesService = salesService;
    }

    @PostMapping
    public ResponseEntity<ApiResponseDto<Void>> createSale(
            @Valid @RequestBody SalesRequestDto request
    ) {
        salesService.createSale(request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.SALES_INVOICE_CREATED));
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<PageResponseDto<SalesListResponseDto>>> getSales(
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Positive int size,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fromDate,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate toDate
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.SALES_INVOICES_RETRIEVED,
                salesService.getSales(page, size, search, fromDate, toDate)
        ));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponseDto<SalesDetailResponseDto>> getSaleById(@PathVariable @Positive Long id) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.SALES_INVOICE_RETRIEVED,
                salesService.getSaleById(id)
        ));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> updateSale(
            @PathVariable @Positive Long id,
            @Valid @RequestBody SalesRequestDto request
    ) {
        salesService.updateSale(id, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.SALES_INVOICE_UPDATED));
    }

    @PutMapping("/{id}/cancel")
    public ResponseEntity<ApiResponseDto<Void>> cancelSale(@PathVariable @Positive Long id) {
        salesService.cancelSale(id);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.SALES_INVOICE_CANCELLED));
    }

    @GetMapping("/{id}/invoice")
    public ResponseEntity<ApiResponseDto<SalesInvoiceResponseDto>> getInvoice(@PathVariable @Positive Long id) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.SALES_INVOICE_PRINT_RETRIEVED,
                salesService.getInvoice(id)
        ));
    }
}
