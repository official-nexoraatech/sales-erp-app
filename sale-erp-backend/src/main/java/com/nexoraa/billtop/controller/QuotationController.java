package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.quotation.QuotationConvertRequestDto;
import com.nexoraa.billtop.dto.quotation.QuotationCreateResponseDto;
import com.nexoraa.billtop.dto.quotation.QuotationDetailResponseDto;
import com.nexoraa.billtop.dto.quotation.QuotationListResponseDto;
import com.nexoraa.billtop.dto.quotation.QuotationRequestDto;
import com.nexoraa.billtop.dto.sales.SalesCreateResponseDto;
import com.nexoraa.billtop.service.QuotationService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Positive;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
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
@RequestMapping("/api/v1/quotations")
public class QuotationController {

    private final QuotationService quotationService;

    public QuotationController(QuotationService quotationService) {
        this.quotationService = quotationService;
    }

    @PostMapping
    public ResponseEntity<ApiResponseDto<QuotationCreateResponseDto>> createQuotation(
            @Valid @RequestBody QuotationRequestDto request
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.QUOTATION_CREATED,
                quotationService.createQuotation(request)
        ));
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<PageResponseDto<QuotationListResponseDto>>> getQuotations(
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Positive int size,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) Long customerId,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fromDate,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate toDate
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.QUOTATIONS_RETRIEVED,
                quotationService.getQuotations(page, size, search, customerId, status, fromDate, toDate)
        ));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponseDto<QuotationDetailResponseDto>> getQuotationById(@PathVariable @Positive Long id) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.QUOTATION_RETRIEVED,
                quotationService.getQuotationById(id)
        ));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> updateQuotation(
            @PathVariable @Positive Long id,
            @Valid @RequestBody QuotationRequestDto request
    ) {
        quotationService.updateQuotation(id, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.QUOTATION_UPDATED));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> deleteQuotation(@PathVariable @Positive Long id) {
        quotationService.deleteQuotation(id);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.QUOTATION_DELETED));
    }

    @PostMapping("/{id}/convert-to-invoice")
    public ResponseEntity<ApiResponseDto<SalesCreateResponseDto>> convertToInvoice(
            @PathVariable @Positive Long id,
            @RequestBody(required = false) QuotationConvertRequestDto request
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.QUOTATION_CONVERTED,
                quotationService.convertToInvoice(id, request)
        ));
    }
}
