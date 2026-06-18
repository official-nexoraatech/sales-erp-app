package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.returning.ReturnDetailResponseDto;
import com.nexoraa.billtop.dto.returning.ReturnListResponseDto;
import com.nexoraa.billtop.dto.sales.SalesReturnRequestDto;
import com.nexoraa.billtop.service.SalesReturnService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Positive;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Validated
@RestController
@RequestMapping("/api/v1/sales-returns")
public class SalesReturnController {

    private final SalesReturnService salesReturnService;

    public SalesReturnController(SalesReturnService salesReturnService) {
        this.salesReturnService = salesReturnService;
    }

    @PostMapping
    public ResponseEntity<ApiResponseDto<Void>> createSalesReturn(
            @Valid @RequestBody SalesReturnRequestDto request
    ) {
        salesReturnService.createSalesReturn(request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.SALES_RETURN_CREATED));
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<PageResponseDto<ReturnListResponseDto>>> getSalesReturns(
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Positive int size
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.SALES_RETURNS_RETRIEVED,
                salesReturnService.getSalesReturns(page, size)
        ));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponseDto<ReturnDetailResponseDto>> getSalesReturnById(@PathVariable @Positive Long id) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.SALES_RETURN_RETRIEVED,
                salesReturnService.getSalesReturnById(id)
        ));
    }
}
