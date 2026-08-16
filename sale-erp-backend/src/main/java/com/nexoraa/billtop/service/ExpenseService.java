package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.expense.ExpenseCreateResponseDto;
import com.nexoraa.billtop.dto.expense.ExpenseListResponseDto;
import com.nexoraa.billtop.dto.expense.ExpenseRequestDto;
import com.nexoraa.billtop.dto.expense.ExpenseResponseDto;

import java.time.LocalDate;

public interface ExpenseService {

    ExpenseCreateResponseDto createExpense(ExpenseRequestDto request);

    PageResponseDto<ExpenseListResponseDto> getExpenses(int page, int size, String search, LocalDate fromDate, LocalDate toDate);

    ExpenseResponseDto getExpenseById(Long id);

    void updateExpense(Long id, ExpenseRequestDto request);

    void deleteExpense(Long id);
}
