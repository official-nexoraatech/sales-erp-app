package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.staff.AttendanceRequestDto;
import com.nexoraa.billtop.dto.staff.AttendanceResponseDto;
import com.nexoraa.billtop.dto.staff.AttendanceSummaryResponseDto;
import com.nexoraa.billtop.enums.StaffAttendanceStatus;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.service.StaffAttendanceService;
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
@RequestMapping("/api/v1/staff/attendance")
public class StaffAttendanceController {

    private final StaffAttendanceService attendanceService;

    public StaffAttendanceController(StaffAttendanceService attendanceService) {
        this.attendanceService = attendanceService;
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<List<AttendanceResponseDto>>> getAttendance(
            @RequestParam(required = false) String date,
            @RequestParam(required = false) String department,
            @RequestParam(required = false) String employee,
            @RequestParam(required = false) String status
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.STAFF_ATTENDANCE_RETRIEVED,
                attendanceService.getAttendance(parseDate(date), department, employee, parseStatus(status))
        ));
    }

    @PostMapping
    public ResponseEntity<ApiResponseDto<Void>> markAttendance(@Valid @RequestBody AttendanceRequestDto request) {
        attendanceService.markAttendance(request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.STAFF_ATTENDANCE_MARKED));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> updateAttendance(
            @PathVariable @Positive Long id,
            @Valid @RequestBody AttendanceRequestDto request
    ) {
        attendanceService.updateAttendance(id, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.STAFF_ATTENDANCE_UPDATED));
    }

    @GetMapping("/summary")
    public ResponseEntity<ApiResponseDto<List<AttendanceSummaryResponseDto>>> getSummary(
            @RequestParam(required = false) String month,
            @RequestParam(required = false) String year
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.STAFF_ATTENDANCE_SUMMARY_RETRIEVED,
                attendanceService.getSummary(parseInteger(month, ErrorMessage.INVALID_MONTH, "INVALID_MONTH"),
                        parseInteger(year, ErrorMessage.INVALID_YEAR, "INVALID_YEAR"))
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

    private StaffAttendanceStatus parseStatus(String status) {
        if (!StringUtils.hasText(status)) {
            return null;
        }
        try {
            return StaffAttendanceStatus.valueOf(status.trim().toUpperCase());
        } catch (IllegalArgumentException ex) {
            throw new BadRequestException(ErrorMessage.INVALID_STATUS, "INVALID_STATUS");
        }
    }

    private Integer parseInteger(String value, String message, String code) {
        if (!StringUtils.hasText(value)) {
            return null;
        }
        try {
            return Integer.valueOf(value.trim());
        } catch (NumberFormatException ex) {
            throw new BadRequestException(message, code);
        }
    }
}
