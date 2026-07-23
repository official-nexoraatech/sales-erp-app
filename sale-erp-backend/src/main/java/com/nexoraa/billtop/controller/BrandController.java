package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.brand.BrandRequestDto;
import com.nexoraa.billtop.dto.brand.BrandResponseDto;
import com.nexoraa.billtop.service.BrandService;
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

import java.util.List;

@Validated
@RestController
@RequestMapping("/api/v1/brands")
public class BrandController {

    private final BrandService brandService;

    public BrandController(BrandService brandService) {
        this.brandService = brandService;
    }

    @PostMapping
    public ResponseEntity<ApiResponseDto<Void>> createBrand(@Valid @RequestBody BrandRequestDto request) {
        brandService.createBrand(request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.BRAND_CREATED));
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<PageResponseDto<BrandResponseDto>>> getBrands(
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Positive int size,
            @RequestParam(required = false) String search
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.BRANDS_RETRIEVED, brandService.getBrands(page, size, search)));
    }

    @GetMapping("/category/{categoryId}")
    public ResponseEntity<ApiResponseDto<List<BrandResponseDto>>> getBrandsByCategoryId(
            @PathVariable @Positive Long categoryId
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.BRANDS_RETRIEVED,
                brandService.getBrandsByCategoryId(categoryId)
        ));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> updateBrand(
            @PathVariable @Positive Long id,
            @Valid @RequestBody BrandRequestDto request
    ) {
        brandService.updateBrand(id, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.BRAND_UPDATED));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> deleteBrand(@PathVariable @Positive Long id) {
        brandService.deleteBrand(id);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.BRAND_DELETED));
    }
}
