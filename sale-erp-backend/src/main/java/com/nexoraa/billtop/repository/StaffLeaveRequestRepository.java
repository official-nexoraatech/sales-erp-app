package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.StaffLeaveRequest;
import com.nexoraa.billtop.enums.StaffLeaveStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.math.BigDecimal;
import java.util.Optional;

public interface StaffLeaveRequestRepository extends JpaRepository<StaffLeaveRequest, Long>, JpaSpecificationExecutor<StaffLeaveRequest> {

    Optional<StaffLeaveRequest> findByIdAndOrganizationIdAndIsDeletedFalse(Long id, Long organizationId);

    @Query("""
            select sum(leave.days)
            from StaffLeaveRequest leave
            where leave.organization.id = :organizationId
              and leave.employee.id = :employeeId
              and lower(leave.leaveType) = lower(:leaveType)
              and leave.status = :status
              and leave.isDeleted = false
            """)
    BigDecimal sumDaysByLeaveTypeAndStatus(
            @Param("organizationId") Long organizationId,
            @Param("employeeId") Long employeeId,
            @Param("leaveType") String leaveType,
            @Param("status") StaffLeaveStatus status
    );
}
