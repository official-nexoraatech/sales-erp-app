package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.staff.LeaveBalanceResponseDto;
import com.nexoraa.billtop.dto.staff.LeaveRejectRequestDto;
import com.nexoraa.billtop.dto.staff.LeaveRequestDto;
import com.nexoraa.billtop.dto.staff.LeaveResponseDto;
import com.nexoraa.billtop.enums.StaffLeaveStatus;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.service.StaffLeaveService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Positive;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.List;

@Validated
@RestController
@RequestMapping("/api/v1/staff/leaves")
public class StaffLeaveController {

    private final StaffLeaveService leaveService;

    public StaffLeaveController(StaffLeaveService leaveService) {
        this.leaveService = leaveService;
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<List<LeaveResponseDto>>> getLeaves(
            @RequestParam(required = false) String employee,
            @RequestParam(required = false) String leaveType,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String fromDate,
            @RequestParam(required = false) String toDate
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.STAFF_LEAVES_RETRIEVED,
                leaveService.getLeaves(employee, leaveType, parseStatus(status), parseDate(fromDate), parseDate(toDate))
        ));
    }

    @PostMapping
    public ResponseEntity<ApiResponseDto<Void>> createLeave(@Valid @RequestBody LeaveRequestDto request) {
        leaveService.createLeave(request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.STAFF_LEAVE_CREATED));
    }

    @PutMapping("/{id}/approve")
    public ResponseEntity<ApiResponseDto<Void>> approveLeave(@PathVariable @Positive Long id) {
        leaveService.approveLeave(id);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.STAFF_LEAVE_APPROVED));
    }

    @PutMapping("/{id}/reject")
    public ResponseEntity<ApiResponseDto<Void>> rejectLeave(
            @PathVariable @Positive Long id,
            @RequestBody(required = false) LeaveRejectRequestDto request
    ) {
        leaveService.rejectLeave(id, request == null ? new LeaveRejectRequestDto() : request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.STAFF_LEAVE_REJECTED));
    }

    @PutMapping("/{id}/cancel")
    public ResponseEntity<ApiResponseDto<Void>> cancelLeave(@PathVariable @Positive Long id) {
        leaveService.cancelLeave(id);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.STAFF_LEAVE_CANCELLED));
    }

    @GetMapping("/balance")
    public ResponseEntity<ApiResponseDto<List<LeaveBalanceResponseDto>>> getLeaveBalance(
            @RequestParam @Positive Long employeeId
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.STAFF_LEAVE_BALANCE_RETRIEVED,
                leaveService.getLeaveBalance(employeeId)
        ));
    }

    private LocalDate parseDate(String date) {
        if (!StringUtils.hasText(date)) {
            return null;
        }
        try {
            return LocalDate.parse(date.trim());
        } catch (DateTimeParseException ex) {
            throw new BadRequestException(ErrorMessage.INVALID_DATE, "INVALID_DATE");
        }
    }

    private StaffLeaveStatus parseStatus(String status) {
        if (!StringUtils.hasText(status)) {
            return null;
        }
        try {
            return StaffLeaveStatus.valueOf(status.trim().toUpperCase());
        } catch (IllegalArgumentException ex) {
            throw new BadRequestException(ErrorMessage.INVALID_STATUS, "INVALID_STATUS");
        }
    }
}
