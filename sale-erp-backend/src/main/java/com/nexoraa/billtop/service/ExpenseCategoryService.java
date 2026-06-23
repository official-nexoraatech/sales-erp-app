package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.common.IdResponseDto;
import com.nexoraa.billtop.dto.expense.ExpenseCategoryRequestDto;
import com.nexoraa.billtop.dto.expense.ExpenseCategoryResponseDto;

import java.util.List;

public interface ExpenseCategoryService {

    IdResponseDto createExpenseCategory(ExpenseCategoryRequestDto request);

    List<ExpenseCategoryResponseDto> getExpenseCategories(String search);

    ExpenseCategoryResponseDto getExpenseCategoryById(Long id);

    void updateExpenseCategory(Long id, ExpenseCategoryRequestDto request);

    void deleteExpenseCategory(Long id);
}
