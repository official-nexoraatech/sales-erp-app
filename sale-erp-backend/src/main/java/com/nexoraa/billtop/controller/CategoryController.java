package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.category.CategoryRequestDto;
import com.nexoraa.billtop.dto.category.CategoryResponseDto;
import com.nexoraa.billtop.service.CategoryService;
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
@RequestMapping("/api/v1/categories")
public class CategoryController {

    private final CategoryService categoryService;

    public CategoryController(CategoryService categoryService) {
        this.categoryService = categoryService;
    }

    @PostMapping
    public ResponseEntity<ApiResponseDto<Void>> createCategory(@Valid @RequestBody CategoryRequestDto request) {
        categoryService.createCategory(request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.CATEGORY_CREATED));
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<List<CategoryResponseDto>>> getCategories(
            @RequestParam(required = false) String search
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.CATEGORIES_RETRIEVED,
                categoryService.getCategories(search)
        ));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> updateCategory(
            @PathVariable @Positive Long id,
            @Valid @RequestBody CategoryRequestDto request
    ) {
        categoryService.updateCategory(id, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.CATEGORY_UPDATED));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> deleteCategory(@PathVariable @Positive Long id) {
        categoryService.deleteCategory(id);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.CATEGORY_DELETED));
    }
}
