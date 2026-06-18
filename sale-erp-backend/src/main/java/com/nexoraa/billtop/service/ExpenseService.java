package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.expense.ExpenseCreateResponseDto;
import com.nexoraa.billtop.dto.expense.ExpenseRequestDto;
import com.nexoraa.billtop.dto.expense.ExpenseResponseDto;

public interface ExpenseService {

    ExpenseCreateResponseDto createExpense(ExpenseRequestDto request);

    PageResponseDto<ExpenseResponseDto> getExpenses(int page, int size);

    ExpenseResponseDto getExpenseById(Long id);

    void updateExpense(Long id, ExpenseRequestDto request);

    void deleteExpense(Long id);
}
