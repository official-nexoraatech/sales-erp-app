package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.brand.BrandRequestDto;
import com.nexoraa.billtop.dto.brand.BrandResponseDto;
import com.nexoraa.billtop.dto.common.IdResponseDto;

import java.util.List;

public interface BrandService {

    void createBrand(BrandRequestDto request);

    PageResponseDto<BrandResponseDto> getBrands(int page, int size, String search);

    List<BrandResponseDto> getBrandsByCategoryId(Long categoryId);

    void updateBrand(Long id, BrandRequestDto request);

    void deleteBrand(Long id);
}
