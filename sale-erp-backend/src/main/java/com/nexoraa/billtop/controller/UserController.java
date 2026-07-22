package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.branch.BranchResponseDto;
import com.nexoraa.billtop.dto.common.FileUploadResponseDto;
import com.nexoraa.billtop.dto.user.ChangePasswordRequestDto;
import com.nexoraa.billtop.dto.user.CreateUserRequestDto;
import com.nexoraa.billtop.dto.user.UpdateProfileRequestDto;
import com.nexoraa.billtop.dto.user.UpdateUserRequestDto;
import com.nexoraa.billtop.dto.user.UserProfileResponseDto;
import com.nexoraa.billtop.dto.user.UserResponseDto;
import com.nexoraa.billtop.service.BranchService;
import com.nexoraa.billtop.service.UserService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Positive;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
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
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

@Validated
@RestController
@RequestMapping("/api/v1/users")
public class UserController {

    private final UserService userService;
    private final BranchService branchService;

    public UserController(UserService userService, BranchService branchService) {
        this.userService = userService;
        this.branchService = branchService;
    }

    @PostMapping
    public ResponseEntity<ApiResponseDto<Void>> createUser(
            @Valid @RequestBody CreateUserRequestDto request
    ) {
        userService.createUser(request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.USER_CREATED));
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<List<UserResponseDto>>> getUsersByOrganization(
            @RequestParam(required = false) String search
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.USERS_RETRIEVED,
                userService.getUsersByOrganization(search)
        ));
    }

    @GetMapping("/me/branches")
    public ResponseEntity<ApiResponseDto<List<BranchResponseDto>>> getMyBranches() {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.BRANCHES_RETRIEVED,
                branchService.getMyBranches()
        ));
    }

    @GetMapping("/profile")
    public ResponseEntity<ApiResponseDto<UserProfileResponseDto>> getProfile() {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.PROFILE_RETRIEVED,
                userService.getProfile()
        ));
    }

    @PutMapping("/change-password")
    public ResponseEntity<ApiResponseDto<Void>> changePassword(
            @Valid @RequestBody ChangePasswordRequestDto request
    ) {
        userService.changePassword(request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.PASSWORD_CHANGED));
    }

    @PutMapping("/update-profile")
    public ResponseEntity<ApiResponseDto<Void>> updateProfile(
            @Valid @RequestBody UpdateProfileRequestDto request
    ) {
        userService.updateProfile(request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.PROFILE_UPDATED));
    }

    @PostMapping(value = "/{id}/profile-image", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<ApiResponseDto<FileUploadResponseDto>> uploadProfileImage(
            @PathVariable @Positive Long id,
            @RequestParam MultipartFile file
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.PROFILE_IMAGE_UPLOADED,
                userService.uploadProfileImage(id, file)
        ));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> updateUser(
            @PathVariable @Positive Long id,
            @Valid @RequestBody UpdateUserRequestDto request
    ) {
        userService.updateUser(id, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.USER_UPDATED));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> deleteUser(@PathVariable @Positive Long id) {
        userService.deleteUser(id);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.USER_DELETED));
    }
}
