package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.stock.StockAdjustmentRequestDto;
import com.nexoraa.billtop.dto.stock.StockAdjustmentResponseDto;
import com.nexoraa.billtop.service.StockAdjustmentService;
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
@RequestMapping("/api/v1/stocks/adjustments")
public class StockAdjustmentController {

    private final StockAdjustmentService stockAdjustmentService;

    public StockAdjustmentController(StockAdjustmentService stockAdjustmentService) {
        this.stockAdjustmentService = stockAdjustmentService;
    }

    @PostMapping
    public ResponseEntity<ApiResponseDto<Void>> createAdjustment(
            @Valid @RequestBody StockAdjustmentRequestDto request
    ) {
        stockAdjustmentService.createAdjustment(request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.STOCK_ADJUSTMENT_COMPLETED));
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<PageResponseDto<StockAdjustmentResponseDto>>> getAdjustments(
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Positive int size
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.STOCK_ADJUSTMENTS_RETRIEVED,
                stockAdjustmentService.getAdjustments(page, size)
        ));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponseDto<StockAdjustmentResponseDto>> getAdjustmentById(
            @PathVariable @Positive Long id
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.STOCK_ADJUSTMENT_RETRIEVED,
                stockAdjustmentService.getAdjustmentById(id)
        ));
    }
}
