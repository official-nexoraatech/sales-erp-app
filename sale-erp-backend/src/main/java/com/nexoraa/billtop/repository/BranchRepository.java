package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.Branch;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface BranchRepository extends JpaRepository<Branch, Long>, JpaSpecificationExecutor<Branch> {

    boolean existsByBranchCodeIgnoreCaseAndOrganizationId(String branchCode, Long organizationId);

    boolean existsByBranchCodeIgnoreCaseAndIdNotAndOrganizationId(String branchCode, Long id, Long organizationId);

    Optional<Branch> findByIdAndOrganizationIdAndIsActiveTrue(Long id, Long organizationId);

    List<Branch> findAllByOrganizationIdAndIsActiveTrueOrderByBranchNameAsc(Long organizationId);

    List<Branch> findAllByIdInAndOrganizationId(Collection<Long> ids, Long organizationId);

    Optional<Branch> findByIdAndOrganizationId(Long id, Long organizationId);
}
