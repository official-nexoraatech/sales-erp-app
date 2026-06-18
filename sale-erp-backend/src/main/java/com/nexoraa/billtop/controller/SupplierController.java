package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.ledger.LedgerResponseDto;
import com.nexoraa.billtop.dto.supplier.SupplierDetailResponseDto;
import com.nexoraa.billtop.dto.supplier.SupplierListResponseDto;
import com.nexoraa.billtop.dto.supplier.SupplierRequestDto;
import com.nexoraa.billtop.service.SupplierService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Positive;
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

@Validated
@RestController
@RequestMapping("/api/v1/suppliers")
public class SupplierController {

    private final SupplierService supplierService;

    public SupplierController(SupplierService supplierService) {
        this.supplierService = supplierService;
    }

    @PostMapping
    public ResponseEntity<ApiResponseDto<Void>> createSupplier(
            @Valid @RequestBody SupplierRequestDto request
    ) {
        supplierService.createSupplier(request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.SUPPLIER_CREATED));
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<PageResponseDto<SupplierListResponseDto>>> getSuppliers(
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Positive int size,
            @RequestParam(required = false) String search
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.SUPPLIERS_RETRIEVED,
                supplierService.getSuppliers(page, size, search)
        ));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponseDto<SupplierDetailResponseDto>> getSupplierById(@PathVariable @Positive Long id) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.SUPPLIER_RETRIEVED,
                supplierService.getSupplierById(id)
        ));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> updateSupplier(
            @PathVariable @Positive Long id,
            @Valid @RequestBody SupplierRequestDto request
    ) {
        supplierService.updateSupplier(id, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.SUPPLIER_UPDATED));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> deleteSupplier(@PathVariable @Positive Long id) {
        supplierService.deleteSupplier(id);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.SUPPLIER_DELETED));
    }

    @GetMapping("/{id}/ledger")
    public ResponseEntity<ApiResponseDto<LedgerResponseDto>> getSupplierLedger(@PathVariable @Positive Long id) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.SUPPLIER_LEDGER_RETRIEVED,
                supplierService.getSupplierLedger(id)
        ));
    }
}
