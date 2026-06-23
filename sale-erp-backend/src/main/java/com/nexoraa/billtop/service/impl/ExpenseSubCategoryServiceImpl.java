package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.common.IdResponseDto;
import com.nexoraa.billtop.dto.expense.ExpenseSubCategoryRequestDto;
import com.nexoraa.billtop.dto.expense.ExpenseSubCategoryResponseDto;
import com.nexoraa.billtop.entity.ExpenseCategory;
import com.nexoraa.billtop.entity.ExpenseSubCategory;
import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.repository.ExpenseCategoryRepository;
import com.nexoraa.billtop.repository.ExpenseSubCategoryRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.ExpenseSubCategoryService;
import com.nexoraa.billtop.specification.MasterDataSpecification;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class ExpenseSubCategoryServiceImpl implements ExpenseSubCategoryService {

    private final ExpenseSubCategoryRepository expenseSubCategoryRepository;
    private final ExpenseCategoryRepository expenseCategoryRepository;
    private final CurrentOrganizationService currentOrganizationService;

    public ExpenseSubCategoryServiceImpl(
            ExpenseSubCategoryRepository expenseSubCategoryRepository,
            ExpenseCategoryRepository expenseCategoryRepository,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.expenseSubCategoryRepository = expenseSubCategoryRepository;
        this.expenseCategoryRepository = expenseCategoryRepository;
        this.currentOrganizationService = currentOrganizationService;
    }

    @Override
    @Transactional
    public IdResponseDto createExpenseSubCategory(ExpenseSubCategoryRequestDto request) {
        ExpenseCategory category = getActiveExpenseCategory(request.getExpenseCategoryId());
        if (expenseSubCategoryRepository.existsByNameIgnoreCaseAndExpenseCategoryIdAndStatusAndIsDeletedFalse(
                request.getName(),
                category.getId(),
                Status.ACTIVE
        )) {
            throw new BadRequestException(
                    ErrorMessage.EXPENSE_SUB_CATEGORY_ALREADY_EXISTS,
                    "EXPENSE_SUB_CATEGORY_ALREADY_EXISTS"
            );
        }

        ExpenseSubCategory subCategory = ExpenseSubCategory.builder()
                .expenseCategory(category)
                .name(request.getName())
                .description(request.getDescription())
                .status(request.getStatus() == null ? Status.ACTIVE : request.getStatus())
                .build();
        return IdResponseDto.builder().id(expenseSubCategoryRepository.save(subCategory).getId()).build();
    }

    @Override
    @Transactional(readOnly = true)
    public List<ExpenseSubCategoryResponseDto> getExpenseSubCategories(String search) {
        Long organizationId = currentOrganizationService.getOrganizationId();

        Specification<ExpenseSubCategory> specification = MasterDataSpecification.<ExpenseSubCategory>active()
                .and((root, query, criteriaBuilder) -> criteriaBuilder.isFalse(root.get("isDeleted")))
                .and((root, query, criteriaBuilder) -> criteriaBuilder.equal(
                        root.get("expenseCategory").get("organization").get("id"),
                        organizationId
                ))
                .and((root, query, criteriaBuilder) -> criteriaBuilder.equal(
                        root.get("expenseCategory").get("status"),
                        Status.ACTIVE
                ))
                .and((root, query, criteriaBuilder) -> criteriaBuilder.isFalse(
                        root.get("expenseCategory").get("isDeleted")
                ))
                .and(MasterDataSpecification.search(search, "name", "description"));

        return expenseSubCategoryRepository.findAll(specification, Sort.by(Sort.Direction.ASC, "name"))
                .stream()
                .map(this::toResponse)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<ExpenseSubCategoryResponseDto> getExpenseSubCategoriesByCategoryId(Long expenseCategoryId) {
        ExpenseCategory category = getActiveExpenseCategory(expenseCategoryId);
        return expenseSubCategoryRepository
                .findAllByExpenseCategoryIdAndExpenseCategoryOrganizationIdAndStatusAndIsDeletedFalseOrderByNameAsc(
                        category.getId(),
                        currentOrganizationService.getOrganizationId(),
                        Status.ACTIVE
                )
                .stream()
                .filter(subCategory -> subCategory.getExpenseCategory() != null
                        && !Boolean.TRUE.equals(subCategory.getExpenseCategory().getIsDeleted())
                        && Status.ACTIVE.equals(subCategory.getExpenseCategory().getStatus()))
                .map(this::toResponse)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public ExpenseSubCategoryResponseDto getExpenseSubCategoryById(Long id) {
        return toResponse(getActiveExpenseSubCategory(id));
    }

    @Override
    @Transactional
    public void updateExpenseSubCategory(Long id, ExpenseSubCategoryRequestDto request) {
        ExpenseSubCategory subCategory = getActiveExpenseSubCategory(id);
        ExpenseCategory category = getActiveExpenseCategory(request.getExpenseCategoryId());
        if (expenseSubCategoryRepository.existsByNameIgnoreCaseAndIdNotAndExpenseCategoryIdAndStatusAndIsDeletedFalse(
                request.getName(),
                id,
                category.getId(),
                Status.ACTIVE
        )) {
            throw new BadRequestException(
                    ErrorMessage.EXPENSE_SUB_CATEGORY_ALREADY_EXISTS,
                    "EXPENSE_SUB_CATEGORY_ALREADY_EXISTS"
            );
        }

        subCategory.setExpenseCategory(category);
        subCategory.setName(request.getName());
        subCategory.setDescription(request.getDescription());
        if (request.getStatus() != null) {
            subCategory.setStatus(request.getStatus());
        }
        expenseSubCategoryRepository.save(subCategory);
    }

    @Override
    @Transactional
    public void deleteExpenseSubCategory(Long id) {
        ExpenseSubCategory subCategory = getActiveExpenseSubCategory(id);
        subCategory.setStatus(Status.INACTIVE);
        subCategory.setIsDeleted(true);
        expenseSubCategoryRepository.save(subCategory);
    }

    private ExpenseCategory getActiveExpenseCategory(Long id) {
        return expenseCategoryRepository.findByIdAndOrganizationIdAndStatusAndIsDeletedFalse(
                        id,
                        currentOrganizationService.getOrganizationId(),
                        Status.ACTIVE
                )
                .orElseThrow(() -> new ResourceNotFoundException(
                        ErrorMessage.EXPENSE_CATEGORY_NOT_FOUND,
                        "EXPENSE_CATEGORY_NOT_FOUND"
                ));
    }

    private ExpenseSubCategory getActiveExpenseSubCategory(Long id) {
        ExpenseSubCategory subCategory = expenseSubCategoryRepository
                .findByIdAndExpenseCategoryOrganizationIdAndStatusAndIsDeletedFalse(
                        id,
                        currentOrganizationService.getOrganizationId(),
                        Status.ACTIVE
                )
                .orElseThrow(() -> new ResourceNotFoundException(
                        ErrorMessage.EXPENSE_SUB_CATEGORY_NOT_FOUND,
                        "EXPENSE_SUB_CATEGORY_NOT_FOUND"
        ));
        ExpenseCategory category = subCategory.getExpenseCategory();
        if (category == null || Boolean.TRUE.equals(category.getIsDeleted()) || !Status.ACTIVE.equals(category.getStatus())) {
            throw new ResourceNotFoundException(
                    ErrorMessage.EXPENSE_SUB_CATEGORY_NOT_FOUND,
                    "EXPENSE_SUB_CATEGORY_NOT_FOUND"
            );
        }
        return subCategory;
    }

    private ExpenseSubCategoryResponseDto toResponse(ExpenseSubCategory subCategory) {
        ExpenseCategory category = subCategory.getExpenseCategory();
        return ExpenseSubCategoryResponseDto.builder()
                .id(subCategory.getId())
                .expenseCategoryId(category.getId())
                .expenseCategoryName(category.getName())
                .name(subCategory.getName())
                .description(subCategory.getDescription())
                .status(subCategory.getStatus())
                .build();
    }
}
