package com.nexoraa.billtop.mapper;

import com.nexoraa.billtop.dto.user.UserProfileResponseDto;
import com.nexoraa.billtop.dto.user.UserResponseDto;
import com.nexoraa.billtop.entity.User;
import org.mapstruct.Builder;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;

@Mapper(componentModel = "spring", builder = @Builder(disableBuilder = true))
public interface UserMapper {

    @Mapping(target = "roleId", source = "role.id")
    @Mapping(target = "roleName", source = "role.name")
    @Mapping(target = "organizationId", source = "organization.id")
    @Mapping(target = "organizationName", source = "organization.name")
    @Mapping(target = "branchIds", ignore = true)
    UserResponseDto toResponseDto(User user);

    @Mapping(target = "roleName", source = "role.name")
    UserProfileResponseDto toProfileResponseDto(User user);
}

