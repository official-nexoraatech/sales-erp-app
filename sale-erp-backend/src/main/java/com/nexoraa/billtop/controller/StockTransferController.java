package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.stock.StockTransferRequestDto;
import com.nexoraa.billtop.dto.stock.StockTransferResponseDto;
import com.nexoraa.billtop.service.StockTransferService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Positive;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Validated
@RestController
@RequestMapping("/api/v1/stocks/transfers")
public class StockTransferController {

    private final StockTransferService stockTransferService;

    public StockTransferController(StockTransferService stockTransferService) {
        this.stockTransferService = stockTransferService;
    }

    @PostMapping
    public ResponseEntity<ApiResponseDto<Void>> transferStock(
            @Valid @RequestBody StockTransferRequestDto request
    ) {
        stockTransferService.transferStock(request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.STOCK_TRANSFERRED));
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<PageResponseDto<StockTransferResponseDto>>> getTransfers(
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Positive int size
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.STOCK_TRANSFERS_RETRIEVED,
                stockTransferService.getTransfers(page, size)
        ));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponseDto<StockTransferResponseDto>> getTransferById(@PathVariable @Positive Long id) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.STOCK_TRANSFER_RETRIEVED,
                stockTransferService.getTransferById(id)
        ));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> updateTransfer(
            @PathVariable @Positive Long id,
            @Valid @RequestBody StockTransferRequestDto request
    ) {
        stockTransferService.updateTransfer(id, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.STOCK_TRANSFER_UPDATED));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> deleteTransfer(@PathVariable @Positive Long id) {
        stockTransferService.deleteTransfer(id);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.STOCK_TRANSFER_DELETED));
    }
}
