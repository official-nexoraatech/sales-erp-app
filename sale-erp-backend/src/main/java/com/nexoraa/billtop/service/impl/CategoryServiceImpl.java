package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.category.CategoryRequestDto;
import com.nexoraa.billtop.dto.category.CategoryResponseDto;
import com.nexoraa.billtop.dto.common.IdResponseDto;
import com.nexoraa.billtop.entity.Category;
import com.nexoraa.billtop.entity.Organization;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.mapper.CategoryMapper;
import com.nexoraa.billtop.repository.CategoryRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.CategoryService;
import com.nexoraa.billtop.specification.MasterDataSpecification;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CategoryServiceImpl implements CategoryService {

    private final CategoryRepository categoryRepository;
    private final CategoryMapper categoryMapper;
    private final CurrentOrganizationService currentOrganizationService;

    public CategoryServiceImpl(
            CategoryRepository categoryRepository,
            CategoryMapper categoryMapper,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.categoryRepository = categoryRepository;
        this.categoryMapper = categoryMapper;
        this.currentOrganizationService = currentOrganizationService;
    }

    @Override
    @Transactional
    public IdResponseDto createCategory(CategoryRequestDto request) {
        Organization organization = currentOrganizationService.getOrganizationReference();
        Long organizationId = organization.getId();
        if (categoryRepository.existsByNameIgnoreCaseAndOrganizationIdAndStatusAndIsDeletedFalse(
                request.getName(),
                organizationId,
                com.nexoraa.billtop.enums.Status.ACTIVE
        )) {
            throw new BadRequestException(ErrorMessage.CATEGORY_ALREADY_EXISTS, "CATEGORY_ALREADY_EXISTS");
        }
        Category category = categoryMapper.toEntity(request);
        category.setOrganization(organization);
        return IdResponseDto.builder().id(categoryRepository.save(category).getId()).build();
    }

    @Override
    @Transactional(readOnly = true)
    public PageResponseDto<CategoryResponseDto> getCategories(int page, int size, String search) {
        Specification<Category> specification = MasterDataSpecification.<Category>active()
                .and(MasterDataSpecification.organization(currentOrganizationService.getOrganizationId()))
                .and((root, query, criteriaBuilder) -> criteriaBuilder.isFalse(root.get("isDeleted")))
                .and(MasterDataSpecification.search(search, "name", "description"));
        Page<Category> categories = categoryRepository.findAll(
                specification,
                PageRequest.of(page, size, Sort.by(Sort.Direction.ASC, "name"))
        );
        return PageResponseDto.from(categories.map(categoryMapper::toResponse));
    }

    @Override
    @Transactional
    public void updateCategory(Long id, CategoryRequestDto request) {
        Category category = getActiveCategory(id);
        Long organizationId = currentOrganizationService.getOrganizationId();
        if (categoryRepository.existsByNameIgnoreCaseAndIdNotAndOrganizationIdAndStatusAndIsDeletedFalse(
                request.getName(),
                id,
                organizationId,
        com.nexoraa.billtop.enums.Status.ACTIVE)) {
            throw new BadRequestException(ErrorMessage.CATEGORY_ALREADY_EXISTS, "CATEGORY_ALREADY_EXISTS");
        }
        categoryMapper.updateEntity(request, category);
        categoryRepository.save(category);
    }

    @Override
    @Transactional
    public void deleteCategory(Long id) {
        Category category = getActiveCategory(id);
        category.setStatus(com.nexoraa.billtop.enums.Status.INACTIVE);
        category.setIsDeleted(true);
        categoryRepository.save(category);
    }

    private Category getActiveCategory(Long id) {
        return categoryRepository.findByIdAndOrganizationIdAndStatusAndIsDeletedFalse(
                        id,
                        currentOrganizationService.getOrganizationId(),
                        com.nexoraa.billtop.enums.Status.ACTIVE
                )
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.CATEGORY_NOT_FOUND, "CATEGORY_NOT_FOUND"));
    }
}





