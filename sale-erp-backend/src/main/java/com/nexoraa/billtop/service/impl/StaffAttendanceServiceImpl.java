package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.staff.AttendanceRequestDto;
import com.nexoraa.billtop.dto.staff.AttendanceResponseDto;
import com.nexoraa.billtop.dto.staff.AttendanceSummaryResponseDto;
import com.nexoraa.billtop.entity.Employee;
import com.nexoraa.billtop.entity.StaffAttendance;
import com.nexoraa.billtop.enums.StaffAttendanceStatus;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.repository.EmployeeRepository;
import com.nexoraa.billtop.repository.StaffAttendanceRepository;
import com.nexoraa.billtop.repository.StaffAttendanceSummaryProjection;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.StaffAttendanceService;
import com.nexoraa.billtop.specification.StaffSpecification;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.DateTimeException;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.YearMonth;
import java.util.List;

@Service
public class StaffAttendanceServiceImpl implements StaffAttendanceService {

    private static final BigDecimal ZERO = BigDecimal.ZERO;

    private final StaffAttendanceRepository attendanceRepository;
    private final EmployeeRepository employeeRepository;
    private final CurrentOrganizationService currentOrganizationService;

    public StaffAttendanceServiceImpl(
            StaffAttendanceRepository attendanceRepository,
            EmployeeRepository employeeRepository,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.attendanceRepository = attendanceRepository;
        this.employeeRepository = employeeRepository;
        this.currentOrganizationService = currentOrganizationService;
    }

    @Override
    @Transactional(readOnly = true)
    public List<AttendanceResponseDto> getAttendance(
            LocalDate date,
            String department,
            String employee,
            StaffAttendanceStatus status
    ) {
        Specification<StaffAttendance> specification = StaffSpecification.<StaffAttendance>organization(currentOrganizationService.getOrganizationId())
                .and(StaffSpecification.notDeleted())
                .and(StaffSpecification.attendanceFilters(date, department, employee, status));
        return attendanceRepository.findAll(specification, Sort.by(Sort.Direction.DESC, "attendanceDate", "id"))
                .stream()
                .map(this::toResponse)
                .toList();
    }

    @Override
    @Transactional
    public void markAttendance(AttendanceRequestDto request) {
        Long organizationId = currentOrganizationService.getOrganizationId();
        Employee employee = getEmployee(request.getEmployeeId());
        StaffAttendance attendance = attendanceRepository.findByOrganizationIdAndEmployeeIdAndAttendanceDateAndIsDeletedFalse(
                        organizationId,
                        request.getEmployeeId(),
                        request.getDate()
                )
                .orElseGet(StaffAttendance::new);
        if (attendance.getId() == null) {
            attendance.setOrganization(currentOrganizationService.getOrganizationReference());
            attendance.setEmployee(employee);
            attendance.setAttendanceDate(request.getDate());
        }
        applyRequest(request, attendance, employee);
        attendanceRepository.save(attendance);
    }

    @Override
    @Transactional
    public void updateAttendance(Long id, AttendanceRequestDto request) {
        StaffAttendance attendance = getAttendanceRecord(id);
        Employee employee = getEmployee(request.getEmployeeId());
        attendanceRepository.findByOrganizationIdAndEmployeeIdAndAttendanceDateAndIsDeletedFalse(
                        currentOrganizationService.getOrganizationId(),
                        request.getEmployeeId(),
                        request.getDate()
                )
                .filter(existing -> !existing.getId().equals(id))
                .ifPresent(existing -> {
                    throw new BadRequestException(
                            ErrorMessage.STAFF_ATTENDANCE_ALREADY_EXISTS,
                            "STAFF_ATTENDANCE_ALREADY_EXISTS"
                    );
                });
        applyRequest(request, attendance, employee);
        attendanceRepository.save(attendance);
    }

    @Override
    @Transactional(readOnly = true)
    public List<AttendanceSummaryResponseDto> getSummary(Integer month, Integer year) {
        if (month == null || year == null) {
            throw new BadRequestException(ErrorMessage.BAD_REQUEST, "MONTH_YEAR_REQUIRED");
        }

        YearMonth yearMonth;
        try {
            yearMonth = YearMonth.of(year, month);
        } catch (DateTimeException ex) {
            throw new BadRequestException(ErrorMessage.INVALID_MONTH, "INVALID_MONTH");
        }

        return attendanceRepository.summarizeByStatus(
                        currentOrganizationService.getOrganizationId(),
                        yearMonth.atDay(1),
                        yearMonth.atEndOfMonth()
                )
                .stream()
                .map(this::toSummaryResponse)
                .toList();
    }

    private StaffAttendance getAttendanceRecord(Long id) {
        return attendanceRepository.findByIdAndOrganizationIdAndIsDeletedFalse(
                        id,
                        currentOrganizationService.getOrganizationId()
                )
                .orElseThrow(() -> new ResourceNotFoundException(
                        ErrorMessage.STAFF_ATTENDANCE_NOT_FOUND,
                        "STAFF_ATTENDANCE_NOT_FOUND"
                ));
    }

    private Employee getEmployee(Long id) {
        return employeeRepository.findByIdAndOrganizationIdAndIsDeletedFalse(
                        id,
                        currentOrganizationService.getOrganizationId()
                )
                .orElseThrow(() -> new ResourceNotFoundException(
                        ErrorMessage.STAFF_EMPLOYEE_NOT_FOUND,
                        "STAFF_EMPLOYEE_NOT_FOUND"
                ));
    }

    private void applyRequest(AttendanceRequestDto request, StaffAttendance attendance, Employee employee) {
        attendance.setEmployee(employee);
        attendance.setAttendanceDate(request.getDate());
        attendance.setCheckIn(request.getCheckIn());
        attendance.setCheckOut(request.getCheckOut());
        attendance.setTotalHours(calculateTotalHours(request.getCheckIn(), request.getCheckOut()));
        attendance.setStatus(request.getStatus());
        attendance.setNote(request.getNote());
    }

    private AttendanceResponseDto toResponse(StaffAttendance attendance) {
        Employee employee = attendance.getEmployee();
        return AttendanceResponseDto.builder()
                .id(attendance.getId())
                .employeeId(employee.getId())
                .employeeCode(employee.getEmployeeCode())
                .employeeName(employee.getFirstName() + " " + employee.getLastName())
                .department(employee.getDepartment())
                .date(attendance.getAttendanceDate())
                .checkIn(attendance.getCheckIn())
                .checkOut(attendance.getCheckOut())
                .totalHours(defaultZero(attendance.getTotalHours()))
                .status(attendance.getStatus())
                .note(attendance.getNote())
                .build();
    }

    private AttendanceSummaryResponseDto toSummaryResponse(StaffAttendanceSummaryProjection projection) {
        return AttendanceSummaryResponseDto.builder()
                .status(projection.getStatus())
                .count(projection.getCount())
                .build();
    }

    private BigDecimal calculateTotalHours(LocalTime checkIn, LocalTime checkOut) {
        if (checkIn == null || checkOut == null || !checkOut.isAfter(checkIn)) {
            return ZERO;
        }
        long minutes = Duration.between(checkIn, checkOut).toMinutes();
        return BigDecimal.valueOf(minutes)
                .divide(BigDecimal.valueOf(60), 2, RoundingMode.HALF_UP);
    }

    private BigDecimal defaultZero(BigDecimal value) {
        return value == null ? ZERO : value;
    }
}
