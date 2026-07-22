package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.entity.Warehouse;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.Optional;

public interface WarehouseRepository extends JpaRepository<Warehouse, Long>, JpaSpecificationExecutor<Warehouse> {

    boolean existsByWarehouseCodeIgnoreCaseAndOrganizationIdAndStatus(String warehouseCode, Long organizationId, Status status);

    boolean existsByWarehouseCodeIgnoreCaseAndIdNotAndOrganizationIdAndStatus(
            String warehouseCode,
            Long id,
            Long organizationId,
    Status status);

    Optional<Warehouse> findByIdAndOrganizationIdAndStatus(Long id, Long organizationId, Status status);

    Optional<Warehouse> findByIdAndOrganizationIdAndBranchIdAndStatus(
            Long id,
            Long organizationId,
            Long branchId,
            Status status);
}


