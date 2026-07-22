package com.nexoraa.billtop.service;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.branch.BranchRequestDto;
import com.nexoraa.billtop.dto.branch.BranchResponseDto;
import com.nexoraa.billtop.dto.common.IdResponseDto;
import com.nexoraa.billtop.entity.Branch;
import com.nexoraa.billtop.entity.Organization;
import com.nexoraa.billtop.entity.UserBranchMapping;
import com.nexoraa.billtop.entity.UserBranchMappingId;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.exception.UnauthorizedException;
import com.nexoraa.billtop.mapper.BranchMapper;
import com.nexoraa.billtop.repository.BranchRepository;
import com.nexoraa.billtop.repository.UserBranchMappingRepository;
import com.nexoraa.billtop.repository.UserRepository;
import com.nexoraa.billtop.security.BillTopUserDetails;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.specification.MasterDataSpecification;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class BranchService {

    private final BranchRepository branchRepository;
    private final UserBranchMappingRepository userBranchMappingRepository;
    private final UserRepository userRepository;
    private final BranchMapper branchMapper;
    private final CurrentOrganizationService currentOrganizationService;

    public BranchService(
            BranchRepository branchRepository,
            UserBranchMappingRepository userBranchMappingRepository,
            UserRepository userRepository,
            BranchMapper branchMapper,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.branchRepository = branchRepository;
        this.userBranchMappingRepository = userBranchMappingRepository;
        this.userRepository = userRepository;
        this.branchMapper = branchMapper;
        this.currentOrganizationService = currentOrganizationService;
    }

    /**
     * Seeds a default "Main Branch" for a newly created organization so
     * branch-scoped bootstrap data (e.g. the walk-in customer) has a branch
     * to attach to before an admin creates any branches explicitly.
     */
    @Transactional
    public Branch createDefaultBranch(Organization organization) {
        Branch branch = Branch.builder()
                .organization(organization)
                .branchCode("MAIN")
                .branchName("Main Branch")
                .isActive(true)
                .build();
        return branchRepository.save(branch);
    }

    @Transactional
    public IdResponseDto createBranch(BranchRequestDto request) {
        Organization organization = currentOrganizationService.getOrganizationReference();
        Long organizationId = organization.getId();
        if (branchRepository.existsByBranchCodeIgnoreCaseAndOrganizationId(request.getBranchCode(), organizationId)) {
            throw new BadRequestException(ErrorMessage.BRANCH_ALREADY_EXISTS, "BRANCH_ALREADY_EXISTS");
        }

        Branch branch = branchMapper.toEntity(request);
        branch.setOrganization(organization);
        branch = branchRepository.save(branch);

        assignCreatorToBranch(branch.getId());

        return IdResponseDto.builder().id(branch.getId()).build();
    }

    @Transactional(readOnly = true)
    public List<BranchResponseDto> getBranches(String search) {
        Long organizationId = currentOrganizationService.getOrganizationId();
        Specification<Branch> specification = MasterDataSpecification.<Branch>organization(organizationId)
                .and(activeBranch())
                .and(MasterDataSpecification.search(search, "branchName", "branchCode", "city"));
        return branchRepository.findAll(specification, Sort.by(Sort.Direction.ASC, "branchName"))
                .stream()
                .map(branchMapper::toResponse)
                .toList();
    }

    @Transactional(readOnly = true)
    public BranchResponseDto getBranchById(Long id) {
        return branchMapper.toResponse(getActiveBranch(id));
    }

    /**
     * Super Admin flow: lets the caller list branches for an organization
     * other than their own (e.g. while creating a user for that org),
     * mirroring {@code RoleService.getRolesByOrganizationId}.
     */
    @Transactional(readOnly = true)
    public List<BranchResponseDto> getBranchesByOrganizationId(Long organizationId) {
        return branchRepository.findAllByOrganizationIdAndIsActiveTrueOrderByBranchNameAsc(organizationId)
                .stream()
                .map(branchMapper::toResponse)
                .toList();
    }

    @Transactional
    public void updateBranch(Long id, BranchRequestDto request) {
        Long organizationId = currentOrganizationService.getOrganizationId();
        Branch branch = getActiveBranch(id);
        if (branchRepository.existsByBranchCodeIgnoreCaseAndIdNotAndOrganizationId(
                request.getBranchCode(), id, organizationId)) {
            throw new BadRequestException(ErrorMessage.BRANCH_ALREADY_EXISTS, "BRANCH_ALREADY_EXISTS");
        }
        branchMapper.updateEntity(request, branch);
        branchRepository.save(branch);
    }

    @Transactional
    public void deleteBranch(Long id) {
        Branch branch = getActiveBranch(id);
        branch.setIsActive(false);
        branchRepository.save(branch);
    }

    @Transactional(readOnly = true)
    public List<BranchResponseDto> getMyBranches() {
        BillTopUserDetails userDetails = getCurrentUserDetails();
        Long organizationId = userDetails.organizationId();
        if (organizationId == null) {
            return List.of();
        }

        if (userDetails.isAdmin() || userDetails.isSuperAdmin()) {
            return branchRepository.findAllByOrganizationIdAndIsActiveTrueOrderByBranchNameAsc(organizationId)
                    .stream()
                    .map(branchMapper::toResponse)
                    .toList();
        }

        List<Long> branchIds = userDetails.branchIds();
        if (branchIds == null || branchIds.isEmpty()) {
            return List.of();
        }

        return branchRepository.findAllByIdInAndOrganizationId(branchIds, organizationId)
                .stream()
                .filter(Branch::getIsActive)
                .sorted((a, b) -> a.getBranchName().compareToIgnoreCase(b.getBranchName()))
                .map(branchMapper::toResponse)
                .toList();
    }

    private void assignCreatorToBranch(Long branchId) {
        BillTopUserDetails userDetails = getCurrentUserDetails();
        UserBranchMappingId mappingId = new UserBranchMappingId(userDetails.userId(), branchId);
        if (userBranchMappingRepository.existsById(mappingId)) {
            return;
        }
        UserBranchMapping mapping = UserBranchMapping.builder()
                .id(mappingId)
                .user(userRepository.getReferenceById(userDetails.userId()))
                .branch(branchRepository.getReferenceById(branchId))
                .build();
        userBranchMappingRepository.save(mapping);
    }

    private Branch getActiveBranch(Long id) {
        return branchRepository.findByIdAndOrganizationIdAndIsActiveTrue(
                        id, currentOrganizationService.getOrganizationId())
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.BRANCH_NOT_FOUND, "BRANCH_NOT_FOUND"));
    }

    private Specification<Branch> activeBranch() {
        return (root, query, criteriaBuilder) -> criteriaBuilder.isTrue(root.get("isActive"));
    }

    private BillTopUserDetails getCurrentUserDetails() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof BillTopUserDetails userDetails)) {
            throw new UnauthorizedException(ErrorMessage.UNAUTHORIZED, "USER_CONTEXT_MISSING");
        }
        return userDetails;
    }
}
