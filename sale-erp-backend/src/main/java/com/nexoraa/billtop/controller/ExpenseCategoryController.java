package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.common.IdResponseDto;
import com.nexoraa.billtop.dto.expense.ExpenseCategoryRequestDto;
import com.nexoraa.billtop.dto.expense.ExpenseCategoryResponseDto;
import com.nexoraa.billtop.service.ExpenseCategoryService;
import jakarta.validation.Valid;
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
@RequestMapping("/api/v1/expense-categories")
public class ExpenseCategoryController {

    private final ExpenseCategoryService expenseCategoryService;

    public ExpenseCategoryController(ExpenseCategoryService expenseCategoryService) {
        this.expenseCategoryService = expenseCategoryService;
    }

    @PostMapping
    public ResponseEntity<ApiResponseDto<IdResponseDto>> createExpenseCategory(
            @Valid @RequestBody ExpenseCategoryRequestDto request
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.EXPENSE_CATEGORY_CREATED,
                expenseCategoryService.createExpenseCategory(request)
        ));
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<List<ExpenseCategoryResponseDto>>> getExpenseCategories(
            @RequestParam(required = false) String search
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.EXPENSE_CATEGORIES_RETRIEVED,
                expenseCategoryService.getExpenseCategories(search)
        ));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponseDto<ExpenseCategoryResponseDto>> getExpenseCategoryById(
            @PathVariable @Positive Long id
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.EXPENSE_CATEGORY_RETRIEVED,
                expenseCategoryService.getExpenseCategoryById(id)
        ));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> updateExpenseCategory(
            @PathVariable @Positive Long id,
            @Valid @RequestBody ExpenseCategoryRequestDto request
    ) {
        expenseCategoryService.updateExpenseCategory(id, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.EXPENSE_CATEGORY_UPDATED));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> deleteExpenseCategory(@PathVariable @Positive Long id) {
        expenseCategoryService.deleteExpenseCategory(id);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.EXPENSE_CATEGORY_DELETED));
    }
}
