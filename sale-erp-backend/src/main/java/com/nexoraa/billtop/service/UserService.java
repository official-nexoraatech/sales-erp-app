package com.nexoraa.billtop.service;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.common.FileUploadResponseDto;
import com.nexoraa.billtop.dto.user.ChangePasswordRequestDto;
import com.nexoraa.billtop.dto.user.CreateUserRequestDto;
import com.nexoraa.billtop.dto.user.UpdateProfileRequestDto;
import com.nexoraa.billtop.dto.user.UpdateUserRequestDto;
import com.nexoraa.billtop.dto.user.UserProfileResponseDto;
import com.nexoraa.billtop.dto.user.UserResponseDto;
import com.nexoraa.billtop.entity.Branch;
import com.nexoraa.billtop.entity.Organization;
import com.nexoraa.billtop.entity.Role;
import com.nexoraa.billtop.entity.User;
import com.nexoraa.billtop.entity.UserBranchMapping;
import com.nexoraa.billtop.entity.UserBranchMappingId;
import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.mapper.UserMapper;
import com.nexoraa.billtop.repository.BranchRepository;
import com.nexoraa.billtop.repository.OrganizationRepository;
import com.nexoraa.billtop.repository.RoleRepository;
import com.nexoraa.billtop.repository.UserBranchMappingRepository;
import com.nexoraa.billtop.repository.UserRepository;
import com.nexoraa.billtop.security.BillTopUserDetails;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.exception.UnauthorizedException;
import com.nexoraa.billtop.specification.UserSpecification;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@Service
public class UserService {

    private static final String DEFAULT_PASSWORD_SUFFIX = "@123";
    private static final String ADMIN_ROLE_NAME = "Admin";

    private final UserRepository userRepository;
    private final RoleRepository roleRepository;
    private final OrganizationRepository organizationRepository;
    private final BranchRepository branchRepository;
    private final UserBranchMappingRepository userBranchMappingRepository;
    private final PasswordEncoder passwordEncoder;
    private final UserMapper userMapper;
    private final CurrentOrganizationService currentOrganizationService;
    private final FileStorageService fileStorageService;

    public UserService(
            UserRepository userRepository,
            RoleRepository roleRepository,
            OrganizationRepository organizationRepository,
            BranchRepository branchRepository,
            UserBranchMappingRepository userBranchMappingRepository,
            PasswordEncoder passwordEncoder,
            UserMapper userMapper,
            CurrentOrganizationService currentOrganizationService,
            FileStorageService fileStorageService
    ) {
        this.userRepository = userRepository;
        this.roleRepository = roleRepository;
        this.organizationRepository = organizationRepository;
        this.branchRepository = branchRepository;
        this.userBranchMappingRepository = userBranchMappingRepository;
        this.passwordEncoder = passwordEncoder;
        this.userMapper = userMapper;
        this.currentOrganizationService = currentOrganizationService;
        this.fileStorageService = fileStorageService;
    }

    @Transactional
    public UserResponseDto createUser(CreateUserRequestDto request) {
        if (userRepository.existsByUserName(request.getUserName())) {
            throw new BadRequestException(ErrorMessage.USER_ALREADY_EXISTS, "USER_ALREADY_EXISTS");
        }
        if (userRepository.existsByEmail(request.getEmail())) {
            throw new BadRequestException(ErrorMessage.USER_ALREADY_EXISTS, "EMAIL_ALREADY_EXISTS");
        }

        Organization organization = organizationRepository.findByIdAndStatusAndIsDeletedFalse(
                        resolveOrganizationIdForCreate(request),
                        Status.ACTIVE
                )
                .orElseThrow(() -> new BadRequestException(
                        ErrorMessage.ORGANIZATION_NOT_FOUND,
                        "ORGANIZATION_NOT_FOUND"
                ));
        Role role = getActiveRole(request.getRoleId(), organization.getId());
        guardAdminUserProtection(role.getName());

        User user = User.builder()
                .firstName(request.getFirstName())
                .lastName(request.getLastName())
                .userName(request.getUserName())
                .email(request.getEmail())
                .mobileNo(request.getMobileNo())
                .status(request.getStatus() == null ? Status.ACTIVE : request.getStatus())
                .role(role)
                .organization(organization)
                .password(passwordEncoder.encode(defaultPassword(request.getFirstName())))
                .build();

        user = userRepository.save(user);
        replaceBranchAssignments(user, request.getBranchIds(), organization.getId());

        UserResponseDto response = userMapper.toResponseDto(user);
        response.setBranchIds(userBranchMappingRepository.findBranchIdsByUserId(user.getId()));
        return response;
    }

    @Transactional(readOnly = true)
    public List<UserResponseDto> getUsersByOrganization(String search) {
        return getUsersByOrganizationId(currentOrganizationService.getOrganizationId(), search);
    }

    @Transactional(readOnly = true)
    public List<UserResponseDto> getUsersByOrganizationId(Long organizationId, String search) {
        String searchPattern = StringUtils.hasText(search)
                ? "%" + search.trim().toLowerCase(Locale.ROOT) + "%"
                : null;

        List<UserResponseDto> responses = userRepository.findUsersByOrganization(organizationId, searchPattern)
                .stream()
                .map(userMapper::toResponseDto)
                .toList();
        attachBranchIds(responses);
        return responses;
    }

    @Transactional(readOnly = true)
    public UserResponseDto getUserByIdForOrganization(Long organizationId, Long id) {
        UserResponseDto response = userMapper.toResponseDto(getActiveUser(id, organizationId));
        response.setBranchIds(userBranchMappingRepository.findBranchIdsByUserId(response.getId()));
        return response;
    }

    /**
     * Super Admin listing: {@code organizationId} is optional. When present the
     * result is filtered to that organization; when absent users across every
     * organization are returned, each including their role and organization.
     */
    @Transactional(readOnly = true)
    public PageResponseDto<UserResponseDto> getUsersForAdmin(Long organizationId, String search, int page, int size) {
        if (organizationId != null) {
            organizationRepository.findByIdAndStatusAndIsDeletedFalse(organizationId, Status.ACTIVE)
                    .orElseThrow(() -> new ResourceNotFoundException(
                            ErrorMessage.ORGANIZATION_NOT_FOUND,
                            "ORGANIZATION_NOT_FOUND"
                    ));
        }

        Specification<User> specification = UserSpecification.notDeleted()
                .and(UserSpecification.search(search));
        if (organizationId != null) {
            specification = specification.and(UserSpecification.organization(organizationId));
        }

        Page<User> users = userRepository.findAll(
                specification,
                PageRequest.of(page, size, Sort.by(Sort.Direction.ASC, "firstName", "lastName", "id"))
        );
        Page<UserResponseDto> responses = users.map(userMapper::toResponseDto);
        attachBranchIds(responses.getContent());
        return PageResponseDto.from(responses);
    }

    /**
     * Batches branch-mapping lookups for a page/list of users instead of
     * querying per-user, mirroring the enrichment style used for warehouse summaries.
     */
    private void attachBranchIds(List<UserResponseDto> responses) {
        if (responses.isEmpty()) {
            return;
        }
        List<Long> userIds = responses.stream().map(UserResponseDto::getId).toList();
        Map<Long, List<Long>> branchIdsByUserId = new HashMap<>();
        for (UserBranchMapping mapping : userBranchMappingRepository.findByUserIdIn(userIds)) {
            branchIdsByUserId
                    .computeIfAbsent(mapping.getUser().getId(), key -> new ArrayList<>())
                    .add(mapping.getBranch().getId());
        }
        for (UserResponseDto response : responses) {
            response.setBranchIds(branchIdsByUserId.getOrDefault(response.getId(), List.of()));
        }
    }

    @Transactional(readOnly = true)
    public UserProfileResponseDto getProfile() {
        BillTopUserDetails userDetails = getCurrentUserDetails();
        User user = userRepository.findByUserNameAndOrganizationIdAndStatusAndIsDeletedFalse(
                        userDetails.getUsername(),
                        userDetails.organizationId(),
                        Status.ACTIVE
                )
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.USER_NOT_FOUND, "USER_NOT_FOUND"));
        return userMapper.toProfileResponseDto(user);
    }

    @Transactional
    public void updateUser(Long id, UpdateUserRequestDto request) {
        updateUserForOrganization(currentOrganizationService.getOrganizationId(), id, request);
    }

    @Transactional
    public void updateUserForOrganization(Long organizationId, Long id, UpdateUserRequestDto request) {
        User user = getActiveUser(id, organizationId);
        guardAdminUserProtection(user.getRole().getName());

        if (userRepository.existsByUserNameAndIdNot(request.getUserName(), id)) {
            throw new BadRequestException(ErrorMessage.USER_ALREADY_EXISTS, "USER_ALREADY_EXISTS");
        }
        if (userRepository.existsByEmailAndIdNot(request.getEmail(), id)) {
            throw new BadRequestException(ErrorMessage.USER_ALREADY_EXISTS, "EMAIL_ALREADY_EXISTS");
        }

        user.setFirstName(request.getFirstName());
        user.setLastName(request.getLastName());
        user.setUserName(request.getUserName());
        user.setEmail(request.getEmail());
        user.setMobileNo(request.getMobileNo());
        user.setRole(getActiveRole(request.getRoleId(), organizationId));
        if (request.getStatus() != null) {
            user.setStatus(request.getStatus());
        }
        if (StringUtils.hasText(request.getPassword())) {
            user.setPassword(passwordEncoder.encode(request.getPassword()));
        }

        userRepository.save(user);
        if (request.getBranchIds() != null) {
            replaceBranchAssignments(user, request.getBranchIds(), organizationId);
        }
    }

    /**
     * Wholesale-replaces a user's branch assignments (delete-then-insert),
     * matching how role assignment is already replaced outright rather than diffed.
     */
    private void replaceBranchAssignments(User user, List<Long> branchIds, Long organizationId) {
        userBranchMappingRepository.deleteByUser_Id(user.getId());
        if (branchIds == null || branchIds.isEmpty()) {
            return;
        }

        List<Branch> branches = branchRepository.findAllByIdInAndOrganizationId(branchIds, organizationId);
        if (branches.size() != new HashSet<>(branchIds).size()) {
            throw new BadRequestException(ErrorMessage.BRANCH_NOT_IN_ORGANIZATION, "BRANCH_NOT_IN_ORGANIZATION");
        }

        List<UserBranchMapping> mappings = branches.stream()
                .map(branch -> UserBranchMapping.builder()
                        .id(new UserBranchMappingId(user.getId(), branch.getId()))
                        .user(user)
                        .branch(branch)
                        .build())
                .toList();
        userBranchMappingRepository.saveAll(mappings);
    }

    @Transactional
    public void deleteUser(Long id) {
        deleteUserForOrganization(currentOrganizationService.getOrganizationId(), id);
    }

    @Transactional
    public void deleteUserForOrganization(Long organizationId, Long id) {
        User user = getActiveUser(id, organizationId);
        guardAdminUserProtection(user.getRole().getName());
        user.setStatus(Status.INACTIVE);
        user.setIsDeleted(true);
        userRepository.save(user);
    }

    @Transactional
    public void changePassword(ChangePasswordRequestDto request) {
        BillTopUserDetails userDetails = getCurrentUserDetails();
        User user = userRepository.findByUserNameAndOrganizationIdAndStatusAndIsDeletedFalse(
                        userDetails.getUsername(),
                        userDetails.organizationId(),
                        Status.ACTIVE
                )
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.USER_NOT_FOUND, "USER_NOT_FOUND"));

        if (!passwordEncoder.matches(request.getCurrentPassword(), user.getPassword())) {
            throw new BadRequestException(ErrorMessage.CURRENT_PASSWORD_INVALID, "CURRENT_PASSWORD_INVALID");
        }

        user.setPassword(passwordEncoder.encode(request.getNewPassword()));
        userRepository.save(user);
    }

    @Transactional
    public void updateProfile(UpdateProfileRequestDto request) {
        BillTopUserDetails userDetails = getCurrentUserDetails();
        User user = userRepository.findByUserNameAndOrganizationIdAndStatusAndIsDeletedFalse(
                        userDetails.getUsername(),
                        userDetails.organizationId(),
                        Status.ACTIVE
                )
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.USER_NOT_FOUND, "USER_NOT_FOUND"));

        if (userRepository.existsByUserNameAndIdNot(request.getUserName(), user.getId())) {
            throw new BadRequestException(ErrorMessage.USER_ALREADY_EXISTS, "USER_ALREADY_EXISTS");
        }
        if (userRepository.existsByEmailAndIdNot(request.getEmail(), user.getId())) {
            throw new BadRequestException(ErrorMessage.USER_ALREADY_EXISTS, "EMAIL_ALREADY_EXISTS");
        }

        user.setFirstName(request.getFirstName());
        user.setLastName(request.getLastName());
        user.setUserName(request.getUserName());
        user.setEmail(request.getEmail());
        user.setMobileNo(request.getMobileNo());
        userRepository.save(user);
    }

    @Transactional
    public FileUploadResponseDto uploadProfileImage(Long id, MultipartFile file) {
        Long organizationId = currentOrganizationService.getOrganizationId();
        User user = getActiveUser(id, organizationId);
        FileUploadResponseDto upload = fileStorageService.uploadImage(
                file,
                "organizations/" + organizationId + "/users/" + user.getId()
        );
        user.setProfileImageUrl(upload.getObjectUrl());
        userRepository.save(user);
        return upload;
    }

    private User getActiveUser(Long id, Long organizationId) {
        return userRepository.findByIdAndOrganizationIdAndStatusAndIsDeletedFalse(id, organizationId, Status.ACTIVE)
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.USER_NOT_FOUND, "USER_NOT_FOUND"));
    }

    /**
     * A regular (non-super-admin) logged-in user always gets their own org from the
     * token, regardless of what is in the request body. Super admins (and anonymous
     * callers bootstrapping a brand-new organization's first user) use the org id
     * supplied in the request.
     */
    private Long resolveOrganizationIdForCreate(CreateUserRequestDto request) {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null
                && authentication.getPrincipal() instanceof BillTopUserDetails userDetails
                && !userDetails.isSuperAdmin()) {
            return userDetails.organizationId();
        }
        return request.getOrganizationId();
    }

    /**
     * An Admin-role user cannot create, update, or delete another user whose
     * role is "Admin" — only a Super Admin (whose token role is never "Admin")
     * may. This is keyed off the caller's own role, so Super Admin callers are
     * unaffected.
     */
    private void guardAdminUserProtection(String targetRoleName) {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null
                && authentication.getPrincipal() instanceof BillTopUserDetails userDetails
                && userDetails.isAdmin()
                && ADMIN_ROLE_NAME.equalsIgnoreCase(targetRoleName)) {
            throw new BadRequestException(ErrorMessage.ADMIN_USER_PROTECTED, "ADMIN_USER_PROTECTED");
        }
    }

    private Role getActiveRole(Long roleId, Long organizationId) {
        return roleRepository.findByIdAndOrganizationIdAndStatusAndIsDeletedFalse(roleId, organizationId, Status.ACTIVE)
                .orElseThrow(() -> new BadRequestException(ErrorMessage.ROLE_NOT_FOUND, "ROLE_NOT_FOUND"));
    }

    private String defaultPassword(String firstName) {
        return firstName.trim() + DEFAULT_PASSWORD_SUFFIX;
    }

    private BillTopUserDetails getCurrentUserDetails() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof BillTopUserDetails userDetails)) {
            throw new UnauthorizedException(ErrorMessage.UNAUTHORIZED, "USER_CONTEXT_MISSING");
        }
        return userDetails;
    }
}


