package com.nexoraa.billtop.security;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.entity.Branch;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.repository.BranchRepository;
import org.springframework.stereotype.Service;

@Service
public class CurrentBranchService {

    private final BranchRepository branchRepository;

    public CurrentBranchService(BranchRepository branchRepository) {
        this.branchRepository = branchRepository;
    }

    public Long getBranchId() {
        Long branchId = BranchContext.getBranchId();
        if (branchId == null) {
            throw new BadRequestException(ErrorMessage.BRANCH_REQUIRED, "BRANCH_REQUIRED");
        }
        return branchId;
    }

    public Branch getBranchReference() {
        return branchRepository.getReferenceById(getBranchId());
    }
}
