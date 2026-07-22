package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.user.CreateUserRequestDto;
import com.nexoraa.billtop.dto.user.UpdateUserRequestDto;
import com.nexoraa.billtop.entity.Branch;
import com.nexoraa.billtop.entity.Organization;
import com.nexoraa.billtop.entity.Role;
import com.nexoraa.billtop.entity.User;
import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.mapper.UserMapper;
import com.nexoraa.billtop.repository.BranchRepository;
import com.nexoraa.billtop.repository.OrganizationRepository;
import com.nexoraa.billtop.repository.RoleRepository;
import com.nexoraa.billtop.repository.UserBranchMappingRepository;
import com.nexoraa.billtop.repository.UserRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class UserServiceBranchAssignmentTest {

    @Mock
    private UserRepository userRepository;
    @Mock
    private RoleRepository roleRepository;
    @Mock
    private OrganizationRepository organizationRepository;
    @Mock
    private BranchRepository branchRepository;
    @Mock
    private UserBranchMappingRepository userBranchMappingRepository;
    @Mock
    private PasswordEncoder passwordEncoder;
    @Mock
    private UserMapper userMapper;
    @Mock
    private CurrentOrganizationService currentOrganizationService;
    @Mock
    private FileStorageService fileStorageService;

    private UserService userService;

    @BeforeEach
    void setUp() {
        userService = new UserService(
                userRepository,
                roleRepository,
                organizationRepository,
                branchRepository,
                userBranchMappingRepository,
                passwordEncoder,
                userMapper,
                currentOrganizationService,
                fileStorageService
        );
    }

    @Test
    void createUserRejectsBranchIdsThatDoNotBelongToTheTargetOrganization() {
        Organization organization = Organization.builder().build();
        organization.setId(1L);
        Role role = Role.builder().name("Staff").build();
        role.setId(2L);

        when(userRepository.existsByUserName(any())).thenReturn(false);
        when(userRepository.existsByEmail(any())).thenReturn(false);
        when(organizationRepository.findByIdAndStatusAndIsDeletedFalse(1L, Status.ACTIVE))
                .thenReturn(Optional.of(organization));
        when(roleRepository.findByIdAndOrganizationIdAndStatusAndIsDeletedFalse(2L, 1L, Status.ACTIVE))
                .thenReturn(Optional.of(role));
        when(passwordEncoder.encode(any())).thenReturn("encoded");
        when(userRepository.save(any(User.class))).thenAnswer(invocation -> {
            User user = invocation.getArgument(0);
            user.setId(99L);
            return user;
        });
        // Only one of the two requested branch ids actually belongs to org 1.
        Branch onlyBranch = new Branch();
        onlyBranch.setId(10L);
        when(branchRepository.findAllByIdInAndOrganizationId(List.of(10L, 20L), 1L))
                .thenReturn(List.of(onlyBranch));

        CreateUserRequestDto request = CreateUserRequestDto.builder()
                .firstName("Jane")
                .lastName("Doe")
                .userName("jane")
                .email("jane@example.com")
                .roleId(2L)
                .organizationId(1L)
                .branchIds(List.of(10L, 20L))
                .build();

        assertThatThrownBy(() -> userService.createUser(request))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    void createUserPersistsBranchAssignmentsWhenAllBranchesBelongToTheOrganization() {
        Organization organization = Organization.builder().build();
        organization.setId(1L);
        Role role = Role.builder().name("Staff").build();
        role.setId(2L);

        when(userRepository.existsByUserName(any())).thenReturn(false);
        when(userRepository.existsByEmail(any())).thenReturn(false);
        when(organizationRepository.findByIdAndStatusAndIsDeletedFalse(1L, Status.ACTIVE))
                .thenReturn(Optional.of(organization));
        when(roleRepository.findByIdAndOrganizationIdAndStatusAndIsDeletedFalse(2L, 1L, Status.ACTIVE))
                .thenReturn(Optional.of(role));
        when(passwordEncoder.encode(any())).thenReturn("encoded");
        when(userRepository.save(any(User.class))).thenAnswer(invocation -> {
            User user = invocation.getArgument(0);
            user.setId(99L);
            return user;
        });

        Branch branch = new Branch();
        branch.setId(10L);
        when(branchRepository.findAllByIdInAndOrganizationId(List.of(10L), 1L)).thenReturn(List.of(branch));
        when(userMapper.toResponseDto(any(User.class))).thenReturn(new com.nexoraa.billtop.dto.user.UserResponseDto());

        CreateUserRequestDto request = CreateUserRequestDto.builder()
                .firstName("Jane")
                .lastName("Doe")
                .userName("jane")
                .email("jane@example.com")
                .roleId(2L)
                .organizationId(1L)
                .branchIds(List.of(10L))
                .build();

        userService.createUser(request);

        verify(userBranchMappingRepository, times(1)).deleteByUser_Id(99L);
        verify(userBranchMappingRepository, times(1)).saveAll(anyList());
    }

    @Test
    void updateUserLeavesBranchAssignmentsUntouchedWhenBranchIdsOmitted() {
        Role existingRole = Role.builder().name("Staff").build();
        existingRole.setId(2L);
        User existingUser = User.builder()
                .firstName("Jane")
                .lastName("Doe")
                .userName("jane")
                .email("jane@example.com")
                .role(existingRole)
                .password("old-encoded")
                .build();
        existingUser.setId(5L);

        when(userRepository.findByIdAndOrganizationIdAndStatusAndIsDeletedFalse(5L, 1L, Status.ACTIVE))
                .thenReturn(Optional.of(existingUser));
        when(userRepository.existsByUserNameAndIdNot(any(), anyLong())).thenReturn(false);
        when(userRepository.existsByEmailAndIdNot(any(), anyLong())).thenReturn(false);
        when(roleRepository.findByIdAndOrganizationIdAndStatusAndIsDeletedFalse(2L, 1L, Status.ACTIVE))
                .thenReturn(Optional.of(existingUser.getRole()));

        UpdateUserRequestDto request = UpdateUserRequestDto.builder()
                .firstName("Jane")
                .lastName("Doe")
                .userName("jane")
                .email("jane@example.com")
                .roleId(2L)
                .build();

        userService.updateUserForOrganization(1L, 5L, request);

        verify(userBranchMappingRepository, never()).deleteByUser_Id(any());
    }
}
