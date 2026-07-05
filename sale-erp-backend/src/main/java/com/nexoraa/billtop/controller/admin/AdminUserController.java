package com.nexoraa.billtop.controller.admin;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.user.CreateUserRequestDto;
import com.nexoraa.billtop.dto.user.UpdateUserRequestDto;
import com.nexoraa.billtop.dto.user.UserResponseDto;
import com.nexoraa.billtop.service.UserService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Positive;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Super Admin API (v2) for managing users across the platform. Organization-scoped
 * endpoints identify the organization explicitly via {organizationId} rather than
 * the caller's token; the flat listing endpoint is paginated, searchable, and
 * applies an organization filter only when one is supplied.
 */
@Validated
@RestController
@RequestMapping("/api/v2/admin")
@PreAuthorize("hasAuthority('SUPER_ADMIN')")
public class AdminUserController {

    private final UserService userService;

    public AdminUserController(UserService userService) {
        this.userService = userService;
    }

    @GetMapping("/users")
    public ResponseEntity<ApiResponseDto<PageResponseDto<UserResponseDto>>> getUsers(
            @RequestParam(required = false) @Positive Long organizationId,
            @RequestParam(required = false) String search,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Positive int size
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.USERS_RETRIEVED,
                userService.getUsersForAdmin(organizationId, search, page, size)
        ));
    }

    @PostMapping("/organizations/{organizationId}/users")
    public ResponseEntity<ApiResponseDto<Void>> createUser(
            @PathVariable @Positive Long organizationId,
            @Valid @RequestBody CreateUserRequestDto request
    ) {
        request.setOrganizationId(organizationId);
        userService.createUser(request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.USER_CREATED));
    }

    @GetMapping("/organizations/{organizationId}/users")
    public ResponseEntity<ApiResponseDto<List<UserResponseDto>>> getUsersByOrganization(
            @PathVariable @Positive Long organizationId,
            @RequestParam(required = false) String search
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.USERS_RETRIEVED,
                userService.getUsersByOrganizationId(organizationId, search)
        ));
    }

    @GetMapping("/organizations/{organizationId}/users/{id}")
    public ResponseEntity<ApiResponseDto<UserResponseDto>> getUserById(
            @PathVariable @Positive Long organizationId,
            @PathVariable @Positive Long id
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.USER_RETRIEVED,
                userService.getUserByIdForOrganization(organizationId, id)
        ));
    }

    @PutMapping("/organizations/{organizationId}/users/{id}")
    public ResponseEntity<ApiResponseDto<Void>> updateUser(
            @PathVariable @Positive Long organizationId,
            @PathVariable @Positive Long id,
            @Valid @RequestBody UpdateUserRequestDto request
    ) {
        userService.updateUserForOrganization(organizationId, id, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.USER_UPDATED));
    }

    @DeleteMapping("/organizations/{organizationId}/users/{id}")
    public ResponseEntity<ApiResponseDto<Void>> deleteUser(
            @PathVariable @Positive Long organizationId,
            @PathVariable @Positive Long id
    ) {
        userService.deleteUserForOrganization(organizationId, id);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.USER_DELETED));
    }
}
