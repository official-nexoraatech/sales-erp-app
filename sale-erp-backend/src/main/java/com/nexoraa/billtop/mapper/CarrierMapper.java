package com.nexoraa.billtop.mapper;

import com.nexoraa.billtop.dto.carrier.CarrierRequestDto;
import com.nexoraa.billtop.dto.carrier.CarrierResponseDto;
import com.nexoraa.billtop.entity.ShippingCarrier;
import org.mapstruct.Builder;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.MappingTarget;

@Mapper(componentModel = "spring", builder = @Builder(disableBuilder = true))
public interface CarrierMapper {

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "organization", ignore = true)
    @Mapping(target = "status", expression = "java(request.getStatus() == null ? com.nexoraa.billtop.enums.Status.ACTIVE : request.getStatus())")
    @Mapping(target = "createdAt", ignore = true)
    @Mapping(target = "updatedAt", ignore = true)
    ShippingCarrier toEntity(CarrierRequestDto request);

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "organization", ignore = true)
    @Mapping(target = "status", expression = "java(request.getStatus() == null ? carrier.getStatus() : request.getStatus())")
    @Mapping(target = "createdAt", ignore = true)
    @Mapping(target = "updatedAt", ignore = true)
    void updateEntity(CarrierRequestDto request, @MappingTarget ShippingCarrier carrier);

    CarrierResponseDto toResponse(ShippingCarrier carrier);
}
