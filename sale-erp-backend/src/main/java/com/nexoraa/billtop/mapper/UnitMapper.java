package com.nexoraa.billtop.mapper;

import com.nexoraa.billtop.dto.unit.UnitRequestDto;
import com.nexoraa.billtop.dto.unit.UnitResponseDto;
import com.nexoraa.billtop.entity.Unit;
import org.mapstruct.Builder;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.MappingTarget;

@Mapper(componentModel = "spring", builder = @Builder(disableBuilder = true))
public interface UnitMapper {

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "organization", ignore = true)
    @Mapping(target = "status", constant = "ACTIVE")
    Unit toEntity(UnitRequestDto request);

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "organization", ignore = true)
    @Mapping(target = "status", ignore = true)
    void updateEntity(UnitRequestDto request, @MappingTarget Unit unit);

    UnitResponseDto toResponse(Unit unit);
}


