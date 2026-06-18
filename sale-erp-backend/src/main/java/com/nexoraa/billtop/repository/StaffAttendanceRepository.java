package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.StaffAttendance;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

public interface StaffAttendanceRepository extends JpaRepository<StaffAttendance, Long>, JpaSpecificationExecutor<StaffAttendance> {

    Optional<StaffAttendance> findByOrganizationIdAndEmployeeIdAndAttendanceDateAndIsDeletedFalse(
            Long organizationId,
            Long employeeId,
            LocalDate attendanceDate
    );

    Optional<StaffAttendance> findByIdAndOrganizationIdAndIsDeletedFalse(Long id, Long organizationId);

    @Query("""
            select attendance.status as status, count(attendance.id) as count
            from StaffAttendance attendance
            where attendance.organization.id = :organizationId
              and attendance.attendanceDate between :startDate and :endDate
              and attendance.isDeleted = false
            group by attendance.status
            """)
    List<StaffAttendanceSummaryProjection> summarizeByStatus(
            @Param("organizationId") Long organizationId,
            @Param("startDate") LocalDate startDate,
            @Param("endDate") LocalDate endDate
    );
}
