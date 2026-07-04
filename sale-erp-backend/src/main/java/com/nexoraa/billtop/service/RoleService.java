package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.role.RoleRequestDto;
import com.nexoraa.billtop.dto.role.RoleResponseDto;

import java.util.List;

public interface RoleService {

    void createRole(RoleRequestDto request);

    List<RoleResponseDto> getRoles(String search);

    List<RoleResponseDto> getRolesByOrganizationId(Long organizationId);

    RoleResponseDto getRoleById(Long id);

    void updateRole(Long id, RoleRequestDto request);

    void deleteRole(Long id);

    void createRoleForOrganization(Long organizationId, RoleRequestDto request);

    RoleResponseDto getRoleByIdForOrganization(Long organizationId, Long id);

    void updateRoleForOrganization(Long organizationId, Long id, RoleRequestDto request);

    void deleteRoleForOrganization(Long organizationId, Long id);
}
