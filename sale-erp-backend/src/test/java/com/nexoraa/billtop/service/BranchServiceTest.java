package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.branch.BranchRequestDto;
import com.nexoraa.billtop.dto.branch.BranchResponseDto;
import com.nexoraa.billtop.entity.Branch;
import com.nexoraa.billtop.entity.Organization;
import com.nexoraa.billtop.entity.UserBranchMapping;
import com.nexoraa.billtop.entity.UserBranchMappingId;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.mapper.BranchMapper;
import com.nexoraa.billtop.repository.BranchRepository;
import com.nexoraa.billtop.repository.UserBranchMappingRepository;
import com.nexoraa.billtop.repository.UserRepository;
import com.nexoraa.billtop.security.BillTopUserDetails;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class BranchServiceTest {

    @Mock
    private BranchRepository branchRepository;
    @Mock
    private UserBranchMappingRepository userBranchMappingRepository;
    @Mock
    private UserRepository userRepository;
    @Mock
    private BranchMapper branchMapper;
    @Mock
    private CurrentOrganizationService currentOrganizationService;

    private BranchService branchService;

    @BeforeEach
    void setUp() {
        branchService = new BranchService(
                branchRepository,
                userBranchMappingRepository,
                userRepository,
                branchMapper,
                currentOrganizationService
        );
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void createBranchRejectsDuplicateCodeWithinOrganization() {
        Organization organization = Organization.builder().build();
        organization.setId(1L);
        when(currentOrganizationService.getOrganizationReference()).thenReturn(organization);
        when(branchRepository.existsByBranchCodeIgnoreCaseAndOrganizationId("MAIN", 1L)).thenReturn(true);

        BranchRequestDto request = BranchRequestDto.builder().branchCode("MAIN").branchName("Main").build();

        assertThatThrownBy(() -> branchService.createBranch(request))
                .isInstanceOf(BadRequestException.class);

        verify(branchRepository, never()).save(any());
    }

    @Test
    void createBranchAutoAssignsCreatingAdminToTheNewBranch() {
        authenticateAs("Admin", 5L, List.of());

        Organization organization = Organization.builder().build();
        organization.setId(1L);
        when(currentOrganizationService.getOrganizationReference()).thenReturn(organization);
        when(branchRepository.existsByBranchCodeIgnoreCaseAndOrganizationId("HQ", 1L)).thenReturn(false);

        Branch mapped = new Branch();
        when(branchMapper.toEntity(any())).thenReturn(mapped);

        Branch saved = new Branch();
        saved.setId(50L);
        when(branchRepository.save(mapped)).thenReturn(saved);
        when(userBranchMappingRepository.existsById(new UserBranchMappingId(5L, 50L))).thenReturn(false);
        when(userRepository.getReferenceById(5L)).thenReturn(null);
        when(branchRepository.getReferenceById(50L)).thenReturn(saved);

        BranchRequestDto request = BranchRequestDto.builder().branchCode("HQ").branchName("Headquarters").build();
        branchService.createBranch(request);

        verify(userBranchMappingRepository, times(1)).save(any(UserBranchMapping.class));
    }

    @Test
    void getMyBranchesReturnsAllOrgBranchesForAdminWithoutRequiringExplicitMapping() {
        authenticateAs("Admin", 5L, List.of());

        Branch branch = new Branch();
        branch.setId(1L);
        when(branchRepository.findAllByOrganizationIdAndIsActiveTrueOrderByBranchNameAsc(100L))
                .thenReturn(List.of(branch));
        when(branchMapper.toResponse(branch)).thenReturn(BranchResponseDto.builder().id(1L).build());

        List<BranchResponseDto> result = branchService.getMyBranches();

        assertThat(result).hasSize(1);
        verify(userRepository, never()).findById(anyLong());
    }

    @Test
    void getMyBranchesForStaffOnlyReturnsExplicitlyAssignedBranches() {
        authenticateAs("Staff", 6L, List.of(7L));

        Branch branch = new Branch();
        branch.setId(7L);
        branch.setBranchName("Downtown");
        branch.setIsActive(true);
        when(branchRepository.findAllByIdInAndOrganizationId(List.of(7L), 100L)).thenReturn(List.of(branch));
        when(branchMapper.toResponse(branch)).thenReturn(BranchResponseDto.builder().id(7L).build());

        List<BranchResponseDto> result = branchService.getMyBranches();

        assertThat(result).extracting(BranchResponseDto::getId).containsExactly(7L);
    }

    @Test
    void getMyBranchesForStaffWithNoAssignmentsReturnsEmpty() {
        authenticateAs("Staff", 6L, List.of());

        List<BranchResponseDto> result = branchService.getMyBranches();

        assertThat(result).isEmpty();
        verify(branchRepository, never()).findAllByIdInAndOrganizationId(any(), anyLong());
    }

    private void authenticateAs(String role, Long userId, List<Long> branchIds) {
        BillTopUserDetails userDetails = new BillTopUserDetails(
                userId,
                100L,
                "Acme",
                null,
                "user",
                "encoded",
                role,
                List.of(),
                branchIds,
                true,
                true
        );
        SecurityContextHolder.getContext().setAuthentication(
                UsernamePasswordAuthenticationToken.authenticated(userDetails, null, userDetails.getAuthorities())
        );
    }
}
