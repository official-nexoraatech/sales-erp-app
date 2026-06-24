package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.common.IdResponseDto;
import com.nexoraa.billtop.dto.expense.ExpenseCategoryRequestDto;
import com.nexoraa.billtop.dto.expense.ExpenseCategoryResponseDto;
import com.nexoraa.billtop.entity.ExpenseCategory;
import com.nexoraa.billtop.entity.Organization;
import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.repository.ExpenseCategoryRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.ExpenseCategoryService;
import com.nexoraa.billtop.specification.MasterDataSpecification;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class ExpenseCategoryServiceImpl implements ExpenseCategoryService {

    private final ExpenseCategoryRepository expenseCategoryRepository;
    private final CurrentOrganizationService currentOrganizationService;

    public ExpenseCategoryServiceImpl(
            ExpenseCategoryRepository expenseCategoryRepository,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.expenseCategoryRepository = expenseCategoryRepository;
        this.currentOrganizationService = currentOrganizationService;
    }

    @Override
    @Transactional
    public IdResponseDto createExpenseCategory(ExpenseCategoryRequestDto request) {
        Organization organization = currentOrganizationService.getOrganizationReference();
        Long organizationId = organization.getId();
        if (expenseCategoryRepository.existsByNameIgnoreCaseAndOrganizationIdAndStatusAndIsDeletedFalse(
                request.getName(),
                organizationId,
                Status.ACTIVE
        )) {
            throw new BadRequestException(
                    ErrorMessage.EXPENSE_CATEGORY_ALREADY_EXISTS,
                    "EXPENSE_CATEGORY_ALREADY_EXISTS"
            );
        }

        ExpenseCategory category = ExpenseCategory.builder()
                .organization(organization)
                .name(request.getName())
                .description(request.getDescription())
                .status(request.getStatus() == null ? Status.ACTIVE : request.getStatus())
                .build();
        return IdResponseDto.builder().id(expenseCategoryRepository.save(category).getId()).build();
    }

    @Override
    @Transactional(readOnly = true)
    public List<ExpenseCategoryResponseDto> getExpenseCategories(String search) {
        Specification<ExpenseCategory> specification = MasterDataSpecification.<ExpenseCategory>active()
                .and(MasterDataSpecification.organization(currentOrganizationService.getOrganizationId()))
                .and((root, query, criteriaBuilder) -> criteriaBuilder.isFalse(root.get("isDeleted")))
                .and(MasterDataSpecification.search(search, "name", "description"));

        return expenseCategoryRepository.findAll(specification, Sort.by(Sort.Direction.ASC, "name"))
                .stream()
                .map(this::toResponse)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public ExpenseCategoryResponseDto getExpenseCategoryById(Long id) {
        return toResponse(getActiveExpenseCategory(id));
    }

    @Override
    @Transactional
    public void updateExpenseCategory(Long id, ExpenseCategoryRequestDto request) {
        Long organizationId = currentOrganizationService.getOrganizationId();
        ExpenseCategory category = getActiveExpenseCategory(id);
        if (expenseCategoryRepository.existsByNameIgnoreCaseAndIdNotAndOrganizationIdAndStatusAndIsDeletedFalse(
                request.getName(),
                id,
                organizationId,
                Status.ACTIVE
        )) {
            throw new BadRequestException(
                    ErrorMessage.EXPENSE_CATEGORY_ALREADY_EXISTS,
                    "EXPENSE_CATEGORY_ALREADY_EXISTS"
            );
        }

        category.setName(request.getName());
        category.setDescription(request.getDescription());
        if (request.getStatus() != null) {
            category.setStatus(request.getStatus());
        }
        expenseCategoryRepository.save(category);
    }

    @Override
    @Transactional
    public void deleteExpenseCategory(Long id) {
        ExpenseCategory category = getActiveExpenseCategory(id);
        category.setStatus(Status.INACTIVE);
        category.setIsDeleted(true);
        expenseCategoryRepository.save(category);
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

    private ExpenseCategoryResponseDto toResponse(ExpenseCategory category) {
        return ExpenseCategoryResponseDto.builder()
                .id(category.getId())
                .organizationId(category.getOrganization().getId())
                .name(category.getName())
                .description(category.getDescription())
                .status(category.getStatus())
                .build();
    }
}
