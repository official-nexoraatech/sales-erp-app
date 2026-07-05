package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.role.RoleRequestDto;
import com.nexoraa.billtop.dto.role.RoleResponseDto;
import com.nexoraa.billtop.entity.Role;
import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.mapper.RoleMapper;
import com.nexoraa.billtop.repository.OrganizationRepository;
import com.nexoraa.billtop.repository.RoleRepository;
import com.nexoraa.billtop.security.BillTopUserDetails;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.RoleService;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.util.List;

@Service
public class RoleServiceImpl implements RoleService {

    private static final String ADMIN_ROLE_NAME = "Admin";

    private final RoleRepository roleRepository;
    private final RoleMapper roleMapper;
    private final CurrentOrganizationService currentOrganizationService;
    private final OrganizationRepository organizationRepository;

    public RoleServiceImpl(
            RoleRepository roleRepository,
            RoleMapper roleMapper,
            CurrentOrganizationService currentOrganizationService,
            OrganizationRepository organizationRepository
    ) {
        this.roleRepository = roleRepository;
        this.roleMapper = roleMapper;
        this.currentOrganizationService = currentOrganizationService;
        this.organizationRepository = organizationRepository;
    }

    @Override
    @Transactional
    public void createRole(RoleRequestDto request) {
        createRoleForOrganization(currentOrganizationService.getOrganizationId(), request);
    }

    @Override
    @Transactional
    public void createRoleForOrganization(Long organizationId, RoleRequestDto request) {
        var organization = organizationRepository.findByIdAndStatusAndIsDeletedFalse(organizationId, Status.ACTIVE)
                .orElseThrow(() -> new ResourceNotFoundException(
                        ErrorMessage.ORGANIZATION_NOT_FOUND,
                        "ORGANIZATION_NOT_FOUND"
                ));
        if (roleRepository.existsByNameIgnoreCaseAndOrganizationIdAndStatusAndIsDeletedFalse(
                request.getName(),
                organizationId,
                Status.ACTIVE
        )) {
            throw new BadRequestException(ErrorMessage.ROLE_ALREADY_EXISTS, "ROLE_ALREADY_EXISTS");
        }
        Role role = roleMapper.toEntity(request);
        role.setOrganization(organization);
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
    public List<RoleResponseDto> getRolesByOrganizationId(Long organizationId) {
        organizationRepository.findByIdAndStatusAndIsDeletedFalse(organizationId, Status.ACTIVE)
                .orElseThrow(() -> new ResourceNotFoundException(
                        ErrorMessage.ORGANIZATION_NOT_FOUND,
                        "ORGANIZATION_NOT_FOUND"
                ));

        return roleRepository.findAllByOrganizationIdAndStatusAndIsDeletedFalseOrderByNameAsc(
                        organizationId,
                        Status.ACTIVE
                )
                .stream()
                .map(roleMapper::toResponse)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public RoleResponseDto getRoleById(Long id) {
        return roleMapper.toResponse(getActiveRole(id, currentOrganizationService.getOrganizationId()));
    }

    @Override
    @Transactional(readOnly = true)
    public RoleResponseDto getRoleByIdForOrganization(Long organizationId, Long id) {
        return roleMapper.toResponse(getActiveRole(id, organizationId));
    }

    @Override
    @Transactional
    public void updateRole(Long id, RoleRequestDto request) {
        updateRoleForOrganization(currentOrganizationService.getOrganizationId(), id, request);
    }

    @Override
    @Transactional
    public void updateRoleForOrganization(Long organizationId, Long id, RoleRequestDto request) {
        Role role = getActiveRole(id, organizationId);
        if (roleRepository.existsByNameIgnoreCaseAndIdNotAndOrganizationIdAndStatusAndIsDeletedFalse(
                request.getName(),
                id,
                organizationId,
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
        deleteRoleForOrganization(currentOrganizationService.getOrganizationId(), id);
    }

    @Override
    @Transactional
    public void deleteRoleForOrganization(Long organizationId, Long id) {
        Role role = getActiveRole(id, organizationId);
        guardAdminRoleProtection(role);
        role.setStatus(Status.INACTIVE);
        role.setIsDeleted(true);
        roleRepository.save(role);
    }

    /**
     * An Admin-role user cannot delete the "Admin" role itself — only a Super
     * Admin (whose token role is never "Admin") may. This is keyed off the
     * caller's own role, so Super Admin callers are unaffected.
     */
    private void guardAdminRoleProtection(Role role) {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null
                && authentication.getPrincipal() instanceof BillTopUserDetails userDetails
                && userDetails.isAdmin()
                && ADMIN_ROLE_NAME.equalsIgnoreCase(role.getName())) {
            throw new BadRequestException(ErrorMessage.ADMIN_ROLE_PROTECTED, "ADMIN_ROLE_PROTECTED");
        }
    }

    private Role getActiveRole(Long id, Long organizationId) {
        return roleRepository.findByIdAndOrganizationIdAndStatusAndIsDeletedFalse(
                        id,
                        organizationId,
                        Status.ACTIVE
                )
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.ROLE_NOT_FOUND, "ROLE_NOT_FOUND"));
    }

    @Override
    @Transactional(readOnly = true)
    public List<RoleResponseDto> getRolesForAdmin(Long organizationId, String search) {
        if (organizationId != null) {
            organizationRepository.findByIdAndStatusAndIsDeletedFalse(organizationId, Status.ACTIVE)
                    .orElseThrow(() -> new ResourceNotFoundException(
                            ErrorMessage.ORGANIZATION_NOT_FOUND,
                            "ORGANIZATION_NOT_FOUND"
                    ));
        }

        Specification<Role> specification = adminRoleSpecification(organizationId, search);
        return roleRepository.findAll(specification, Sort.by(Sort.Direction.ASC, "name"))
                .stream()
                .map(roleMapper::toResponse)
                .toList();
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

    private Specification<Role> adminRoleSpecification(Long organizationId, String search) {
        Specification<Role> specification = (root, query, criteriaBuilder) -> criteriaBuilder.isFalse(root.get("isDeleted"));

        if (organizationId != null) {
            specification = specification.and((root, query, criteriaBuilder) ->
                    criteriaBuilder.equal(root.get("organization").get("id"), organizationId)
            );
        }

        if (!StringUtils.hasText(search)) {
            return specification;
        }

        String pattern = "%" + search.trim().toLowerCase() + "%";
        return specification.and((root, query, criteriaBuilder) ->
                criteriaBuilder.like(criteriaBuilder.lower(root.get("name")), pattern)
        );
    }
}



