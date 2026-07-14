package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.purchase.PurchaseCreateResponseDto;
import com.nexoraa.billtop.dto.purchase.PurchaseDetailResponseDto;
import com.nexoraa.billtop.dto.purchase.PurchaseListResponseDto;
import com.nexoraa.billtop.dto.purchase.PurchaseRequestDto;
import com.nexoraa.billtop.dto.purchase.PurchaseStatusRequestDto;
import com.nexoraa.billtop.service.PurchaseService;
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
import java.util.List;

@Validated
@RestController
@RequestMapping("/api/v1/purchases")
public class PurchaseController {

    private final PurchaseService purchaseService;

    public PurchaseController(PurchaseService purchaseService) {
        this.purchaseService = purchaseService;
    }

    @PostMapping
    public ResponseEntity<ApiResponseDto<PurchaseCreateResponseDto>> createPurchase(
            @Valid @RequestBody PurchaseRequestDto request
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.PURCHASE_CREATED,
                purchaseService.createPurchase(request)
        ));
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<PageResponseDto<PurchaseListResponseDto>>> getPurchases(
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Positive int size,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fromDate,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate toDate,
            @RequestParam(required = false) List<String> status,
            @RequestParam(required = false) Long supplierId,
            @RequestParam(required = false) Long stateId
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.PURCHASES_RETRIEVED,
                purchaseService.getPurchases(page, size, search, fromDate, toDate, status, supplierId, stateId)
        ));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponseDto<PurchaseDetailResponseDto>> getPurchaseById(@PathVariable @Positive Long id) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.PURCHASE_RETRIEVED,
                purchaseService.getPurchaseById(id)
        ));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> updatePurchase(
            @PathVariable @Positive Long id,
            @Valid @RequestBody PurchaseRequestDto request
    ) {
        purchaseService.updatePurchase(id, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.PURCHASE_UPDATED));
    }

    @PutMapping("/{id}/status")
    public ResponseEntity<ApiResponseDto<Void>> setPurchaseStatus(
            @PathVariable @Positive Long id,
            @Valid @RequestBody PurchaseStatusRequestDto request
    ) {
        purchaseService.setPurchaseStatus(id, request.getStatus());
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.PURCHASE_UPDATED));
    }

    @PutMapping("/{id}/cancel")
    public ResponseEntity<ApiResponseDto<Void>> cancelPurchase(@PathVariable @Positive Long id) {
        purchaseService.cancelPurchase(id);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.PURCHASE_CANCELLED));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> deletePurchase(@PathVariable @Positive Long id) {
        purchaseService.deletePurchase(id);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.PURCHASE_DELETED));
    }
}
