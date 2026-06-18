package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.role.RoleRequestDto;
import com.nexoraa.billtop.dto.role.RoleResponseDto;
import com.nexoraa.billtop.entity.Role;
import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.mapper.RoleMapper;
import com.nexoraa.billtop.repository.RoleRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.RoleService;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.util.List;

@Service
public class RoleServiceImpl implements RoleService {

    private final RoleRepository roleRepository;
    private final RoleMapper roleMapper;
    private final CurrentOrganizationService currentOrganizationService;

    public RoleServiceImpl(
            RoleRepository roleRepository,
            RoleMapper roleMapper,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.roleRepository = roleRepository;
        this.roleMapper = roleMapper;
        this.currentOrganizationService = currentOrganizationService;
    }

    @Override
    @Transactional
    public void createRole(RoleRequestDto request) {
        Long organizationId = currentOrganizationService.getOrganizationId();
        if (roleRepository.existsByNameIgnoreCaseAndOrganizationIdAndStatusAndIsDeletedFalse(
                request.getName(),
                organizationId,
                Status.ACTIVE
        )) {
            throw new BadRequestException(ErrorMessage.ROLE_ALREADY_EXISTS, "ROLE_ALREADY_EXISTS");
        }
        Role role = roleMapper.toEntity(request);
        role.setOrganization(currentOrganizationService.getOrganizationReference());
        roleRepository.save(role);
    }

    @Override
    @Transactional(readOnly = true)
    public List<RoleResponseDto> getRoles(String search) {
        return roleRepository.findAll(roleSearchSpecification(search), Sort.by(Sort.Direction.ASC, "name"))
                .stream()
                .map(roleMapper::toResponse)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public RoleResponseDto getRoleById(Long id) {
        return roleMapper.toResponse(getActiveRole(id));
    }

    @Override
    @Transactional
    public void updateRole(Long id, RoleRequestDto request) {
        Role role = getActiveRole(id);
        if (roleRepository.existsByNameIgnoreCaseAndIdNotAndOrganizationIdAndStatusAndIsDeletedFalse(
                request.getName(),
                id,
                currentOrganizationService.getOrganizationId(),
                Status.ACTIVE
        )) {
            throw new BadRequestException(ErrorMessage.ROLE_ALREADY_EXISTS, "ROLE_ALREADY_EXISTS");
        }
        roleMapper.updateEntity(request, role);
        roleRepository.save(role);
    }

    @Override
    @Transactional
    public void deleteRole(Long id) {
        Role role = getActiveRole(id);
        role.setStatus(Status.INACTIVE);
        role.setIsDeleted(true);
        roleRepository.save(role);
    }

    private Role getActiveRole(Long id) {
        return roleRepository.findByIdAndOrganizationIdAndStatusAndIsDeletedFalse(
                        id,
                        currentOrganizationService.getOrganizationId(),
                        Status.ACTIVE
                )
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.ROLE_NOT_FOUND, "ROLE_NOT_FOUND"));
    }

    private Specification<Role> roleSearchSpecification(String search) {
        Specification<Role> specification = (root, query, criteriaBuilder) -> criteriaBuilder.and(
                criteriaBuilder.equal(root.get("organization").get("id"), currentOrganizationService.getOrganizationId()),
                criteriaBuilder.isFalse(root.get("isDeleted"))
        );

        if (!StringUtils.hasText(search)) {
            return specification;
        }

        String pattern = "%" + search.trim().toLowerCase() + "%";
        return specification.and((root, query, criteriaBuilder) ->
                criteriaBuilder.like(criteriaBuilder.lower(root.get("name")), pattern)
        );
    }
}



