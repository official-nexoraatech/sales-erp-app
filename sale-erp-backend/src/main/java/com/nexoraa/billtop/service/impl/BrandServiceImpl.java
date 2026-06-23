package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.brand.BrandRequestDto;
import com.nexoraa.billtop.dto.brand.BrandResponseDto;
import com.nexoraa.billtop.dto.common.IdResponseDto;
import com.nexoraa.billtop.entity.Brand;
import com.nexoraa.billtop.entity.Category;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.mapper.BrandMapper;
import com.nexoraa.billtop.repository.BrandRepository;
import com.nexoraa.billtop.repository.CategoryRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.BrandService;
import com.nexoraa.billtop.specification.MasterDataSpecification;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class BrandServiceImpl implements BrandService {

    private final BrandRepository brandRepository;
    private final CategoryRepository categoryRepository;
    private final BrandMapper brandMapper;
    private final CurrentOrganizationService currentOrganizationService;

    public BrandServiceImpl(
            BrandRepository brandRepository,
            CategoryRepository categoryRepository,
            BrandMapper brandMapper,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.brandRepository = brandRepository;
        this.categoryRepository = categoryRepository;
        this.brandMapper = brandMapper;
        this.currentOrganizationService = currentOrganizationService;
    }

    @Override
    @Transactional
    public void createBrand(BrandRequestDto request) {
        Long organizationId = currentOrganizationService.getOrganizationId();
        Category category = getActiveCategory(request.getCategoryId(), organizationId);
        if (brandRepository.existsByNameIgnoreCaseAndCategory_IdAndStatusAndIsDeletedFalse(
                request.getName(),
                category.getId(),
                com.nexoraa.billtop.enums.Status.ACTIVE
        )) {
            throw new BadRequestException(ErrorMessage.BRAND_ALREADY_EXISTS, "BRAND_ALREADY_EXISTS");
        }
        Brand brand = brandMapper.toEntity(request);
        brand.setCategory(category);
        brandRepository.save(brand);

    }

    @Override
    @Transactional(readOnly = true)
    public List<BrandResponseDto> getBrands(String search) {
        Specification<Brand> specification = MasterDataSpecification.<Brand>active()
                .and((root, query, criteriaBuilder) -> criteriaBuilder.equal(
                        root.get("category").get("organization").get("id"),
                        currentOrganizationService.getOrganizationId()
                ))
                .and((root, query, criteriaBuilder) -> criteriaBuilder.isFalse(root.get("isDeleted")))
                .and(MasterDataSpecification.search(search, "name", "description"));
        return brandRepository.findAll(specification, Sort.by(Sort.Direction.ASC, "name"))
                .stream()
                .map(brandMapper::toResponse)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<BrandResponseDto> getBrandsByCategoryId(Long categoryId) {
        Long organizationId = currentOrganizationService.getOrganizationId();
        getActiveCategory(categoryId, organizationId);

        List<BrandResponseDto> brands = brandRepository.findAllByCategory_IdAndStatusAndIsDeletedFalseOrderByNameAsc(
                        categoryId,
                        com.nexoraa.billtop.enums.Status.ACTIVE
                )
                .stream()
                .map(brandMapper::toResponse)
                .toList();
        if (brands.isEmpty()) {
            throw new ResourceNotFoundException(
                    ErrorMessage.BRAND_NOT_FOUND_FOR_CATEGORY,
                    "BRAND_NOT_FOUND_FOR_CATEGORY"
            );
        }
        return brands;
    }

    @Override
    @Transactional
    public void updateBrand(Long id, BrandRequestDto request) {
        Long organizationId = currentOrganizationService.getOrganizationId();
        Category category = getActiveCategory(request.getCategoryId(), organizationId);
        Brand brand = getActiveBrand(id, category.getId());
        if (brandRepository.existsByNameIgnoreCaseAndIdNotAndCategory_IdAndStatusAndIsDeletedFalse(
                request.getName(),
                id,
                category.getId(),
        com.nexoraa.billtop.enums.Status.ACTIVE)) {
            throw new BadRequestException(ErrorMessage.BRAND_ALREADY_EXISTS, "BRAND_ALREADY_EXISTS");
        }
        brandMapper.updateEntity(request, brand);
        brand.setCategory(category);
        brandRepository.save(brand);
    }

    @Override
    @Transactional
    public void deleteBrand(Long id) {
        Brand brand = getActiveBrand(id);
        brand.setStatus(com.nexoraa.billtop.enums.Status.INACTIVE);
        brand.setIsDeleted(true);
        brandRepository.save(brand);
    }

    private Brand getActiveBrand(Long id) {
        Brand brand = brandRepository.findByIdAndStatusAndIsDeletedFalse(
                        id,
                        com.nexoraa.billtop.enums.Status.ACTIVE
                )
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.BRAND_NOT_FOUND, "BRAND_NOT_FOUND"));
        Long organizationId = currentOrganizationService.getOrganizationId();
        if (brand.getCategory() == null
                || brand.getCategory().getOrganization() == null
                || !organizationId.equals(brand.getCategory().getOrganization().getId())) {
            throw new ResourceNotFoundException(ErrorMessage.BRAND_NOT_FOUND, "BRAND_NOT_FOUND");
        }
        return brand;
    }

    private Brand getActiveBrand(Long id, Long categoryId) {
        return brandRepository.findByIdAndCategory_IdAndStatusAndIsDeletedFalse(
                        id,
                        categoryId,
                        com.nexoraa.billtop.enums.Status.ACTIVE
                )
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.BRAND_NOT_FOUND, "BRAND_NOT_FOUND"));
    }

    private Category getActiveCategory(Long categoryId, Long organizationId) {
        return categoryRepository.findByIdAndOrganizationIdAndStatusAndIsDeletedFalse(
                        categoryId,
                        organizationId,
                        com.nexoraa.billtop.enums.Status.ACTIVE
                )
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.CATEGORY_NOT_FOUND, "CATEGORY_NOT_FOUND"));
    }
}



