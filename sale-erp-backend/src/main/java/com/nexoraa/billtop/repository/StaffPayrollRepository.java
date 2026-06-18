package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.StaffPayroll;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.Optional;

public interface StaffPayrollRepository extends JpaRepository<StaffPayroll, Long>, JpaSpecificationExecutor<StaffPayroll> {

    Optional<StaffPayroll> findByOrganizationIdAndEmployeeIdAndPayrollMonthAndIsDeletedFalse(
            Long organizationId,
            Long employeeId,
            String payrollMonth
    );

    Optional<StaffPayroll> findByIdAndOrganizationIdAndIsDeletedFalse(Long id, Long organizationId);
}
