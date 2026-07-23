package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.category.CategoryRequestDto;
import com.nexoraa.billtop.dto.category.CategoryResponseDto;
import com.nexoraa.billtop.dto.common.IdResponseDto;

public interface CategoryService {

    IdResponseDto createCategory(CategoryRequestDto request);

    PageResponseDto<CategoryResponseDto> getCategories(int page, int size, String search);

    void updateCategory(Long id, CategoryRequestDto request);

    void deleteCategory(Long id);
}
