package com.nexoraa.billtop.service;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.common.FileUploadResponseDto;
import com.nexoraa.billtop.dto.user.ChangePasswordRequestDto;
import com.nexoraa.billtop.dto.user.CreateUserRequestDto;
import com.nexoraa.billtop.dto.user.UpdateProfileRequestDto;
import com.nexoraa.billtop.dto.user.UpdateUserRequestDto;
import com.nexoraa.billtop.dto.user.UserProfileResponseDto;
import com.nexoraa.billtop.dto.user.UserResponseDto;
import com.nexoraa.billtop.entity.Organization;
import com.nexoraa.billtop.entity.Role;
import com.nexoraa.billtop.entity.User;
import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.mapper.UserMapper;
import com.nexoraa.billtop.repository.OrganizationRepository;
import com.nexoraa.billtop.repository.RoleRepository;
import com.nexoraa.billtop.repository.UserRepository;
import com.nexoraa.billtop.security.BillTopUserDetails;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.exception.UnauthorizedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Locale;

@Service
public class UserService {

    private static final String DEFAULT_PASSWORD_SUFFIX = "@123";

    private final UserRepository userRepository;
    private final RoleRepository roleRepository;
    private final OrganizationRepository organizationRepository;
    private final PasswordEncoder passwordEncoder;
    private final UserMapper userMapper;
    private final CurrentOrganizationService currentOrganizationService;
    private final FileStorageService fileStorageService;

    public UserService(
            UserRepository userRepository,
            RoleRepository roleRepository,
            OrganizationRepository organizationRepository,
            PasswordEncoder passwordEncoder,
            UserMapper userMapper,
            CurrentOrganizationService currentOrganizationService,
            FileStorageService fileStorageService
    ) {
        this.userRepository = userRepository;
        this.roleRepository = roleRepository;
        this.organizationRepository = organizationRepository;
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

        return userMapper.toResponseDto(userRepository.save(user));
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

        return userRepository.findUsersByOrganization(organizationId, searchPattern)
                .stream()
                .map(userMapper::toResponseDto)
                .toList();
    }

    @Transactional(readOnly = true)
    public UserResponseDto getUserByIdForOrganization(Long organizationId, Long id) {
        return userMapper.toResponseDto(getActiveUser(id, organizationId));
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
    }

    @Transactional
    public void deleteUser(Long id) {
        deleteUserForOrganization(currentOrganizationService.getOrganizationId(), id);
    }

    @Transactional
    public void deleteUserForOrganization(Long organizationId, Long id) {
        User user = getActiveUser(id, organizationId);
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


