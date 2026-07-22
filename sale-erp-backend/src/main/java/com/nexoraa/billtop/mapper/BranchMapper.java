package com.nexoraa.billtop.mapper;

import com.nexoraa.billtop.dto.branch.BranchRequestDto;
import com.nexoraa.billtop.dto.branch.BranchResponseDto;
import com.nexoraa.billtop.entity.Branch;
import org.mapstruct.Builder;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.MappingTarget;

@Mapper(componentModel = "spring", builder = @Builder(disableBuilder = true))
public interface BranchMapper {

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "organization", ignore = true)
    @Mapping(target = "isActive", constant = "true")
    @Mapping(target = "createdAt", ignore = true)
    Branch toEntity(BranchRequestDto request);

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "organization", ignore = true)
    @Mapping(target = "isActive", ignore = true)
    @Mapping(target = "createdAt", ignore = true)
    void updateEntity(BranchRequestDto request, @MappingTarget Branch branch);

    @Mapping(target = "organizationId", source = "organization.id")
    BranchResponseDto toResponse(Branch branch);
}
