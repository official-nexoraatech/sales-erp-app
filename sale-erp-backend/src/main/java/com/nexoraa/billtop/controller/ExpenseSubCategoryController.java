package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.common.IdResponseDto;
import com.nexoraa.billtop.dto.expense.ExpenseSubCategoryRequestDto;
import com.nexoraa.billtop.dto.expense.ExpenseSubCategoryResponseDto;
import com.nexoraa.billtop.service.ExpenseSubCategoryService;
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
@RequestMapping("/api/v1/expense-sub-categories")
public class ExpenseSubCategoryController {

    private final ExpenseSubCategoryService expenseSubCategoryService;

    public ExpenseSubCategoryController(ExpenseSubCategoryService expenseSubCategoryService) {
        this.expenseSubCategoryService = expenseSubCategoryService;
    }

    @PostMapping
    public ResponseEntity<ApiResponseDto<IdResponseDto>> createExpenseSubCategory(
            @Valid @RequestBody ExpenseSubCategoryRequestDto request
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.EXPENSE_SUB_CATEGORY_CREATED,
                expenseSubCategoryService.createExpenseSubCategory(request)
        ));
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<List<ExpenseSubCategoryResponseDto>>> getExpenseSubCategories(
            @RequestParam(required = false) String search
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.EXPENSE_SUB_CATEGORIES_RETRIEVED,
                expenseSubCategoryService.getExpenseSubCategories(search)
        ));
    }

    @GetMapping("/category/{expenseCategoryId}")
    public ResponseEntity<ApiResponseDto<List<ExpenseSubCategoryResponseDto>>> getExpenseSubCategoriesByCategoryId(
            @PathVariable @Positive Long expenseCategoryId
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.EXPENSE_SUB_CATEGORIES_RETRIEVED,
                expenseSubCategoryService.getExpenseSubCategoriesByCategoryId(expenseCategoryId)
        ));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponseDto<ExpenseSubCategoryResponseDto>> getExpenseSubCategoryById(
            @PathVariable @Positive Long id
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.EXPENSE_SUB_CATEGORY_RETRIEVED,
                expenseSubCategoryService.getExpenseSubCategoryById(id)
        ));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> updateExpenseSubCategory(
            @PathVariable @Positive Long id,
            @Valid @RequestBody ExpenseSubCategoryRequestDto request
    ) {
        expenseSubCategoryService.updateExpenseSubCategory(id, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.EXPENSE_SUB_CATEGORY_UPDATED));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> deleteExpenseSubCategory(@PathVariable @Positive Long id) {
        expenseSubCategoryService.deleteExpenseSubCategory(id);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.EXPENSE_SUB_CATEGORY_DELETED));
    }
}
