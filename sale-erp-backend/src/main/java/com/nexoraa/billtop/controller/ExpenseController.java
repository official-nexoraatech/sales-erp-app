package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.expense.ExpenseRequestDto;
import com.nexoraa.billtop.dto.expense.ExpenseResponseDto;
import com.nexoraa.billtop.service.ExpenseService;
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
@RequestMapping("/api/v1/expenses")
public class ExpenseController {

    private final ExpenseService expenseService;

    public ExpenseController(ExpenseService expenseService) {
        this.expenseService = expenseService;
    }

    @PostMapping
    public ResponseEntity<ApiResponseDto<Void>> createExpense(
            @Valid @RequestBody ExpenseRequestDto request
    ) {
        expenseService.createExpense(request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.EXPENSE_CREATED));
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<PageResponseDto<ExpenseResponseDto>>> getExpenses(
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Positive int size
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.EXPENSES_RETRIEVED,
                expenseService.getExpenses(page, size)
        ));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponseDto<ExpenseResponseDto>> getExpenseById(@PathVariable @Positive Long id) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.EXPENSE_RETRIEVED,
                expenseService.getExpenseById(id)
        ));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> updateExpense(
            @PathVariable @Positive Long id,
            @Valid @RequestBody ExpenseRequestDto request
    ) {
        expenseService.updateExpense(id, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.EXPENSE_UPDATED));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> deleteExpense(@PathVariable @Positive Long id) {
        expenseService.deleteExpense(id);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.EXPENSE_DELETED));
    }
}
