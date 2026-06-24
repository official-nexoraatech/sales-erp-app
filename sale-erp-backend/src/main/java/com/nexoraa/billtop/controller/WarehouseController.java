package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.warehouse.WarehouseRequestDto;
import com.nexoraa.billtop.dto.warehouse.WarehouseResponseDto;
import com.nexoraa.billtop.service.WarehouseService;
import jakarta.validation.Valid;
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

import java.util.List;

@Validated
@RestController
@RequestMapping("/api/v1/warehouses")
public class WarehouseController {

    private final WarehouseService warehouseService;

    public WarehouseController(WarehouseService warehouseService) {
        this.warehouseService = warehouseService;
    }

    @PostMapping
    public ResponseEntity<ApiResponseDto<Void>> createWarehouse(
            @Valid @RequestBody WarehouseRequestDto request
    ) {
        warehouseService.createWarehouse(request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.WAREHOUSE_CREATED));
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<List<WarehouseResponseDto>>> getWarehouses(
            @RequestParam(required = false) String search
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.WAREHOUSES_RETRIEVED,
                warehouseService.getWarehouses(search)
        ));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponseDto<WarehouseResponseDto>> getWarehouseById(
            @PathVariable @Positive Long id
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.WAREHOUSE_RETRIEVED,
                warehouseService.getWarehouseById(id)
        ));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> updateWarehouse(
            @PathVariable @Positive Long id,
            @Valid @RequestBody WarehouseRequestDto request
    ) {
        warehouseService.updateWarehouse(id, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.WAREHOUSE_UPDATED));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> deleteWarehouse(@PathVariable @Positive Long id) {
        warehouseService.deleteWarehouse(id);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.WAREHOUSE_DELETED));
    }
}
