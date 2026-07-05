package com.nexoraa.billtop.mapper;

import com.nexoraa.billtop.dto.role.RoleRequestDto;
import com.nexoraa.billtop.dto.role.RoleResponseDto;
import com.nexoraa.billtop.entity.Role;
import org.mapstruct.Builder;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.MappingTarget;

@Mapper(componentModel = "spring", builder = @Builder(disableBuilder = true))
public interface RoleMapper {

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "createdBy", ignore = true)
    @Mapping(target = "updatedBy", ignore = true)
    @Mapping(target = "createdAt", ignore = true)
    @Mapping(target = "updatedAt", ignore = true)
    @Mapping(target = "isDeleted", ignore = true)
    @Mapping(target = "organization", ignore = true)
    @Mapping(target = "status", expression = "java(request.getStatus() == null ? com.nexoraa.billtop.enums.Status.ACTIVE : request.getStatus())")
    Role toEntity(RoleRequestDto request);

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "createdBy", ignore = true)
    @Mapping(target = "updatedBy", ignore = true)
    @Mapping(target = "createdAt", ignore = true)
    @Mapping(target = "updatedAt", ignore = true)
    @Mapping(target = "isDeleted", ignore = true)
    @Mapping(target = "organization", ignore = true)
    @Mapping(target = "status", expression = "java(request.getStatus() == null ? role.getStatus() : request.getStatus())")
    void updateEntity(RoleRequestDto request, @MappingTarget Role role);

    @Mapping(target = "organizationId", source = "organization.id")
    @Mapping(target = "organizationName", source = "organization.name")
    RoleResponseDto toResponse(Role role);
}

