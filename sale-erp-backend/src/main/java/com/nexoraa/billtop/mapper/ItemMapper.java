package com.nexoraa.billtop.mapper;

import com.nexoraa.billtop.dto.item.ItemDetailResponseDto;
import com.nexoraa.billtop.dto.item.ItemListResponseDto;
import com.nexoraa.billtop.dto.item.ItemRequestDto;
import com.nexoraa.billtop.entity.Item;
import org.mapstruct.Builder;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.MappingTarget;

@Mapper(componentModel = "spring", builder = @Builder(disableBuilder = true))
public interface ItemMapper {

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "organization", ignore = true)
    @Mapping(target = "category", ignore = true)
    @Mapping(target = "brand", ignore = true)
    @Mapping(target = "baseUnit", ignore = true)
    @Mapping(target = "secondaryUnit", ignore = true)
    @Mapping(target = "imageUrl", ignore = true)
    @Mapping(target = "status", constant = "ACTIVE")
    @Mapping(target = "createdAt", ignore = true)
    @Mapping(target = "updatedAt", ignore = true)
    Item toEntity(ItemRequestDto request);

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "organization", ignore = true)
    @Mapping(target = "category", ignore = true)
    @Mapping(target = "brand", ignore = true)
    @Mapping(target = "baseUnit", ignore = true)
    @Mapping(target = "secondaryUnit", ignore = true)
    @Mapping(target = "imageUrl", ignore = true)
    @Mapping(target = "status", ignore = true)
    @Mapping(target = "createdAt", ignore = true)
    @Mapping(target = "updatedAt", ignore = true)
    void updateEntity(ItemRequestDto request, @MappingTarget Item item);

    @Mapping(target = "categoryId", source = "category.id")
    @Mapping(target = "categoryName", source = "category.name")
    @Mapping(target = "brandId", source = "brand.id")
    @Mapping(target = "brandName", source = "brand.name")
    @Mapping(target = "baseUnitId", source = "baseUnit.id")
    @Mapping(target = "baseUnitName", source = "baseUnit.name")
    @Mapping(target = "secondaryUnitId", source = "secondaryUnit.id")
    @Mapping(target = "secondaryUnitName", source = "secondaryUnit.name")
    @Mapping(target = "purchasePrice", ignore = true)
    @Mapping(target = "purchasePriceWithTax", ignore = true)
    @Mapping(target = "taxPercentage", ignore = true)
    @Mapping(target = "salePrice", ignore = true)
    @Mapping(target = "wholesalePrice", ignore = true)
    @Mapping(target = "mrp", ignore = true)
    @Mapping(target = "msp", ignore = true)
    @Mapping(target = "discountPercentage", ignore = true)
    @Mapping(target = "profitMargin", ignore = true)
    @Mapping(target = "batchNo", ignore = true)
    @Mapping(target = "manufacturingDate", ignore = true)
    @Mapping(target = "expiryDate", ignore = true)
    @Mapping(target = "availableQty", ignore = true)
    @Mapping(target = "reservedQty", ignore = true)
    @Mapping(target = "minimumStock", ignore = true)
    @Mapping(target = "warehouseId", ignore = true)
    @Mapping(target = "warehouseName", ignore = true)
    ItemDetailResponseDto toDetailResponse(Item item);

    @Mapping(target = "categoryName", source = "category.name")
    @Mapping(target = "brandName", source = "brand.name")
    @Mapping(target = "salePrice", ignore = true)
    @Mapping(target = "availableQty", ignore = true)
    ItemListResponseDto toListResponse(Item item);
}


