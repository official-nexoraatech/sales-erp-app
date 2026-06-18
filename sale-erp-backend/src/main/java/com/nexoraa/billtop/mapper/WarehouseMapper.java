package com.nexoraa.billtop.mapper;

import com.nexoraa.billtop.dto.warehouse.WarehouseRequestDto;
import com.nexoraa.billtop.dto.warehouse.WarehouseResponseDto;
import com.nexoraa.billtop.entity.Warehouse;
import org.mapstruct.Builder;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.MappingTarget;

@Mapper(componentModel = "spring", builder = @Builder(disableBuilder = true))
public interface WarehouseMapper {

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "organization", ignore = true)
    @Mapping(target = "status", constant = "ACTIVE")
    @Mapping(target = "createdAt", ignore = true)
    Warehouse toEntity(WarehouseRequestDto request);

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "organization", ignore = true)
    @Mapping(target = "status", ignore = true)
    @Mapping(target = "createdAt", ignore = true)
    void updateEntity(WarehouseRequestDto request, @MappingTarget Warehouse warehouse);

    WarehouseResponseDto toResponse(Warehouse warehouse);
}


