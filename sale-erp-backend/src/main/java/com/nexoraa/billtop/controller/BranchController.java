package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.branch.BranchRequestDto;
import com.nexoraa.billtop.dto.branch.BranchResponseDto;
import com.nexoraa.billtop.service.BranchService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Positive;
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

import java.util.List;

@Validated
@RestController
@RequestMapping("/api/v1/branches")
public class BranchController {

    private final BranchService branchService;

    public BranchController(BranchService branchService) {
        this.branchService = branchService;
    }

    @PostMapping
    public ResponseEntity<ApiResponseDto<Void>> createBranch(@Valid @RequestBody BranchRequestDto request) {
        branchService.createBranch(request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.BRANCH_CREATED));
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<List<BranchResponseDto>>> getBranches(
            @RequestParam(required = false) String search
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.BRANCHES_RETRIEVED,
                branchService.getBranches(search)
        ));
    }

    @GetMapping("/organization/{organizationId}")
    public ResponseEntity<ApiResponseDto<List<BranchResponseDto>>> getBranchesByOrganizationId(
            @PathVariable @Positive Long organizationId
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.BRANCHES_RETRIEVED,
                branchService.getBranchesByOrganizationId(organizationId)
        ));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponseDto<BranchResponseDto>> getBranchById(@PathVariable @Positive Long id) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.BRANCH_RETRIEVED,
                branchService.getBranchById(id)
        ));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> updateBranch(
            @PathVariable @Positive Long id,
            @Valid @RequestBody BranchRequestDto request
    ) {
        branchService.updateBranch(id, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.BRANCH_UPDATED));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> deleteBranch(@PathVariable @Positive Long id) {
        branchService.deleteBranch(id);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.BRANCH_DELETED));
    }
}
