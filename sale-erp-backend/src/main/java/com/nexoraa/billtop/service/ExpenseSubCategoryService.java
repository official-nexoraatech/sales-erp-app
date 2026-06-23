package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.common.IdResponseDto;
import com.nexoraa.billtop.dto.expense.ExpenseSubCategoryRequestDto;
import com.nexoraa.billtop.dto.expense.ExpenseSubCategoryResponseDto;

import java.util.List;

public interface ExpenseSubCategoryService {

    IdResponseDto createExpenseSubCategory(ExpenseSubCategoryRequestDto request);

    List<ExpenseSubCategoryResponseDto> getExpenseSubCategories(String search);

    List<ExpenseSubCategoryResponseDto> getExpenseSubCategoriesByCategoryId(Long expenseCategoryId);

    ExpenseSubCategoryResponseDto getExpenseSubCategoryById(Long id);

    void updateExpenseSubCategory(Long id, ExpenseSubCategoryRequestDto request);

    void deleteExpenseSubCategory(Long id);
}
