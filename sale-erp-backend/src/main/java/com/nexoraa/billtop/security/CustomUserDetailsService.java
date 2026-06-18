package com.nexoraa.billtop.security;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.entity.RolePermissionMapping;
import com.nexoraa.billtop.entity.User;
import com.nexoraa.billtop.repository.RolePermissionMappingRepository;
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

    public CustomUserDetailsService(
            UserRepository userRepository,
            RolePermissionMappingRepository rolePermissionMappingRepository
    ) {
        this.userRepository = userRepository;
        this.rolePermissionMappingRepository = rolePermissionMappingRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public UserDetails loadUserByUsername(String username) {
        User user = userRepository.findByUserName(username)
                .orElseThrow(() -> new UsernameNotFoundException(ErrorMessage.USER_NOT_FOUND));

        List<String> permissions = rolePermissionMappingRepository
                .findActivePermissionsByRoleId(user.getRole().getId())
                .stream()
                .map(RolePermissionMapping::getPermission)
                .filter(permission -> com.nexoraa.billtop.enums.Status.ACTIVE.equals(permission.getStatus()))
                .map(permission -> permission.getName())
                .distinct()
                .sorted()
                .toList();

        return new BillTopUserDetails(
                user.getId(),
                user.getOrganization().getId(),
                user.getOrganization().getName(),
                user.getOrganization().getLogoUrl(),
                user.getUserName(),
                user.getPassword(),
                user.getRole().getName(),
                permissions,
                com.nexoraa.billtop.enums.Status.ACTIVE.equals(user.getStatus())
        );
    }
}

