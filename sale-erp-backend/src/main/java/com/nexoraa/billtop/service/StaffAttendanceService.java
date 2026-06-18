package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.staff.AttendanceRequestDto;
import com.nexoraa.billtop.dto.staff.AttendanceResponseDto;
import com.nexoraa.billtop.dto.staff.AttendanceSummaryResponseDto;
import com.nexoraa.billtop.enums.StaffAttendanceStatus;

import java.time.LocalDate;
import java.util.List;

public interface StaffAttendanceService {

    List<AttendanceResponseDto> getAttendance(LocalDate date, String department, String employee, StaffAttendanceStatus status);

    void markAttendance(AttendanceRequestDto request);

    void updateAttendance(Long id, AttendanceRequestDto request);

    List<AttendanceSummaryResponseDto> getSummary(Integer month, Integer year);
}
