package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.category.CategoryRequestDto;
import com.nexoraa.billtop.dto.category.CategoryResponseDto;
import com.nexoraa.billtop.dto.common.IdResponseDto;

import java.util.List;

public interface CategoryService {

    IdResponseDto createCategory(CategoryRequestDto request);

    List<CategoryResponseDto> getCategories(String search);

    void updateCategory(Long id, CategoryRequestDto request);

    void deleteCategory(Long id);
}
