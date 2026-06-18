package com.nexoraa.billtop.mapper;

import com.nexoraa.billtop.dto.brand.BrandRequestDto;
import com.nexoraa.billtop.dto.brand.BrandResponseDto;
import com.nexoraa.billtop.entity.Brand;
import org.mapstruct.Builder;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.MappingTarget;

@Mapper(componentModel = "spring", builder = @Builder(disableBuilder = true))
public interface BrandMapper {

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "category", ignore = true)
    @Mapping(target = "status", constant = "ACTIVE")
    Brand toEntity(BrandRequestDto request);

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "category", ignore = true)
    @Mapping(target = "status", ignore = true)
    void updateEntity(BrandRequestDto request, @MappingTarget Brand brand);

    @Mapping(target = "categoryId", source = "category.id")
    @Mapping(target = "categoryName", source = "category.name")
    BrandResponseDto toResponse(Brand brand);
}


