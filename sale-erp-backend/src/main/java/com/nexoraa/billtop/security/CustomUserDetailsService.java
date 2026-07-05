package com.nexoraa.billtop.security;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.entity.RolePermissionMapping;
import com.nexoraa.billtop.entity.UserPermissionMapping;
import com.nexoraa.billtop.entity.User;
import com.nexoraa.billtop.repository.RolePermissionMappingRepository;
import com.nexoraa.billtop.repository.UserPermissionMappingRepository;
import com.nexoraa.billtop.repository.UserRepository;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class CustomUserDetailsService implements UserDetailsService {

    private final UserRepository userRepository;
    private final RolePermissionMappingRepository rolePermissionMappingRepository;
    private final UserPermissionMappingRepository userPermissionMappingRepository;

    public CustomUserDetailsService(
            UserRepository userRepository,
            RolePermissionMappingRepository rolePermissionMappingRepository,
            UserPermissionMappingRepository userPermissionMappingRepository
    ) {
        this.userRepository = userRepository;
        this.rolePermissionMappingRepository = rolePermissionMappingRepository;
        this.userPermissionMappingRepository = userPermissionMappingRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public UserDetails loadUserByUsername(String username) {
        User user = userRepository.findByUserName(username)
                .orElseThrow(() -> new UsernameNotFoundException(ErrorMessage.USER_NOT_FOUND));

        List<String> rolePermissions = rolePermissionMappingRepository
                .findActivePermissionsByRoleId(user.getRole().getId())
                .stream()
                .map(RolePermissionMapping::getPermission)
                .filter(permission -> com.nexoraa.billtop.enums.Status.ACTIVE.equals(permission.getStatus()))
                .map(permission -> permission.getName())
                .distinct()
                .sorted()
                .toList();

        List<String> userPermissions = userPermissionMappingRepository
                .findActivePermissionsByUserId(user.getId())
                .stream()
                .map(UserPermissionMapping::getPermission)
                .filter(permission -> com.nexoraa.billtop.enums.Status.ACTIVE.equals(permission.getStatus()))
                .map(permission -> permission.getName())
                .toList();

        List<String> permissions = java.util.stream.Stream.concat(rolePermissions.stream(), userPermissions.stream())
                .distinct()
                .sorted()
                .toList();

        return new BillTopUserDetails(
                user.getId(),
                user.getOrganization() != null ? user.getOrganization().getId() : null,
                user.getOrganization() != null ? user.getOrganization().getName() : null,
                user.getOrganization() != null ? user.getOrganization().getLogoUrl() : null,
                user.getUserName(),
                user.getPassword(),
                user.getRole().getName(),
                permissions,
                com.nexoraa.billtop.enums.Status.ACTIVE.equals(user.getStatus())
        );
    }
}

