package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.carrier.CarrierRequestDto;
import com.nexoraa.billtop.dto.carrier.CarrierResponseDto;
import com.nexoraa.billtop.service.CarrierService;
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
@RequestMapping("/api/v1/carriers")
public class CarrierController {

    private final CarrierService carrierService;

    public CarrierController(CarrierService carrierService) {
        this.carrierService = carrierService;
    }

    @PostMapping
    public ResponseEntity<ApiResponseDto<Void>> createCarrier(@Valid @RequestBody CarrierRequestDto request) {
        carrierService.createCarrier(request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.CARRIER_CREATED));
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<PageResponseDto<CarrierResponseDto>>> getCarriers(
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Positive int size,
            @RequestParam(required = false) String search
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.CARRIERS_RETRIEVED,
                carrierService.getCarriers(page, size, search)
        ));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponseDto<CarrierResponseDto>> getCarrierById(@PathVariable @Positive Long id) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.CARRIER_RETRIEVED,
                carrierService.getCarrierById(id)
        ));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> updateCarrier(
            @PathVariable @Positive Long id,
            @Valid @RequestBody CarrierRequestDto request
    ) {
        carrierService.updateCarrier(id, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.CARRIER_UPDATED));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> deleteCarrier(@PathVariable @Positive Long id) {
        carrierService.deleteCarrier(id);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.CARRIER_DELETED));
    }
}
