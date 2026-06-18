package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.staff.LeaveBalanceResponseDto;
import com.nexoraa.billtop.dto.staff.LeaveRejectRequestDto;
import com.nexoraa.billtop.dto.staff.LeaveRequestDto;
import com.nexoraa.billtop.dto.staff.LeaveResponseDto;
import com.nexoraa.billtop.enums.StaffLeaveStatus;

import java.time.LocalDate;
import java.util.List;

public interface StaffLeaveService {

    List<LeaveResponseDto> getLeaves(String employee, String leaveType, StaffLeaveStatus status, LocalDate fromDate, LocalDate toDate);

    void createLeave(LeaveRequestDto request);

    void approveLeave(Long id);

    void rejectLeave(Long id, LeaveRejectRequestDto request);

    void cancelLeave(Long id);

    List<LeaveBalanceResponseDto> getLeaveBalance(Long employeeId);
}
