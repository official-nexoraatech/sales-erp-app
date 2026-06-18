package com.nexoraa.billtop.mapper;

import com.nexoraa.billtop.dto.organization.OrganizationAddressResponseDto;
import com.nexoraa.billtop.dto.organization.OrganizationRequestDto;
import com.nexoraa.billtop.dto.organization.OrganizationResponseDto;
import com.nexoraa.billtop.entity.Address;
import com.nexoraa.billtop.entity.Organization;
import org.mapstruct.Builder;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.MappingTarget;

@Mapper(componentModel = "spring", builder = @Builder(disableBuilder = true))
public interface OrganizationMapper {

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "address", ignore = true)
    @Mapping(target = "status", expression = "java(request.getStatus() == null ? com.nexoraa.billtop.enums.Status.ACTIVE : request.getStatus())")
    @Mapping(target = "createdAt", ignore = true)
    @Mapping(target = "updatedAt", ignore = true)
    Organization toEntity(OrganizationRequestDto request);

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "address", ignore = true)
    @Mapping(target = "createdAt", ignore = true)
    @Mapping(target = "updatedAt", ignore = true)
    @Mapping(target = "status", expression = "java(request.getStatus() == null ? organization.getStatus() : request.getStatus())")
    void updateEntity(OrganizationRequestDto request, @MappingTarget Organization organization);

    OrganizationResponseDto toResponse(Organization organization);

    @Mapping(target = "stateId", source = "state.id")
    @Mapping(target = "stateName", source = "state.stateName")
    @Mapping(target = "countryId", source = "country.id")
    @Mapping(target = "countryName", source = "country.name")
    OrganizationAddressResponseDto toAddressResponse(Address address);
}


