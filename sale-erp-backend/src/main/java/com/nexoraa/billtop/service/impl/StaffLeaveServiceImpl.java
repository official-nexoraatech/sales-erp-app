package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.staff.LeaveBalanceResponseDto;
import com.nexoraa.billtop.dto.staff.LeaveRejectRequestDto;
import com.nexoraa.billtop.dto.staff.LeaveRequestDto;
import com.nexoraa.billtop.dto.staff.LeaveResponseDto;
import com.nexoraa.billtop.entity.Employee;
import com.nexoraa.billtop.entity.Organization;
import com.nexoraa.billtop.entity.StaffLeaveRequest;
import com.nexoraa.billtop.entity.StaffSetting;
import com.nexoraa.billtop.enums.StaffLeaveStatus;
import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.repository.EmployeeRepository;
import com.nexoraa.billtop.repository.StaffLeaveRequestRepository;
import com.nexoraa.billtop.repository.StaffSettingRepository;
import com.nexoraa.billtop.security.BillTopUserDetails;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.StaffLeaveService;
import com.nexoraa.billtop.specification.StaffSpecification;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class StaffLeaveServiceImpl implements StaffLeaveService {

    private static final BigDecimal ZERO = BigDecimal.ZERO;
    private static final String LEAVE_TYPES = "leaveTypes";

    private final StaffLeaveRequestRepository leaveRepository;
    private final EmployeeRepository employeeRepository;
    private final StaffSettingRepository settingRepository;
    private final CurrentOrganizationService currentOrganizationService;

    public StaffLeaveServiceImpl(
            StaffLeaveRequestRepository leaveRepository,
            EmployeeRepository employeeRepository,
            StaffSettingRepository settingRepository,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.leaveRepository = leaveRepository;
        this.employeeRepository = employeeRepository;
        this.settingRepository = settingRepository;
        this.currentOrganizationService = currentOrganizationService;
    }

    @Override
    @Transactional(readOnly = true)
    public List<LeaveResponseDto> getLeaves(
            String employee,
            String leaveType,
            StaffLeaveStatus status,
            LocalDate fromDate,
            LocalDate toDate
    ) {
        Specification<StaffLeaveRequest> specification = StaffSpecification.<StaffLeaveRequest>organization(currentOrganizationService.getOrganizationId())
                .and(StaffSpecification.notDeleted())
                .and(StaffSpecification.leaveFilters(employee, leaveType, status, fromDate, toDate));
        return leaveRepository.findAll(specification, Sort.by(Sort.Direction.DESC, "fromDate", "id"))
                .stream()
                .map(this::toResponse)
                .toList();
    }

    @Override
    @Transactional
    public void createLeave(LeaveRequestDto request) {
        if (request.getToDate().isBefore(request.getFromDate())) {
            throw new BadRequestException(ErrorMessage.BAD_REQUEST, "INVALID_LEAVE_DATE_RANGE");
        }
        Employee employee = getEmployee(request.getEmployeeId());
        Organization organization = currentOrganizationService.getOrganizationReference();
        StaffLeaveRequest leave = StaffLeaveRequest.builder()
                .organization(organization)
                .employee(employee)
                .leaveType(request.getLeaveType())
                .fromDate(request.getFromDate())
                .toDate(request.getToDate())
                .days(calculateDays(request.getFromDate(), request.getToDate()))
                .reason(request.getReason())
                .status(StaffLeaveStatus.PENDING)
                .build();
        leaveRepository.save(leave);
    }

    @Override
    @Transactional
    public void approveLeave(Long id) {
        StaffLeaveRequest leave = getLeave(id);
        leave.setStatus(StaffLeaveStatus.APPROVED);
        leave.setApprovedAt(LocalDateTime.now());
        leave.setApprovedBy(resolveCurrentUserId());
        leaveRepository.save(leave);
    }

    @Override
    @Transactional
    public void rejectLeave(Long id, LeaveRejectRequestDto request) {
        StaffLeaveRequest leave = getLeave(id);
        leave.setStatus(StaffLeaveStatus.REJECTED);
        leave.setApprovedAt(LocalDateTime.now());
        leave.setApprovedBy(resolveCurrentUserId());
        leaveRepository.save(leave);
    }

    @Override
    @Transactional
    public void cancelLeave(Long id) {
        StaffLeaveRequest leave = getLeave(id);
        leave.setStatus(StaffLeaveStatus.CANCELLED);
        leaveRepository.save(leave);
    }

    @Override
    @Transactional(readOnly = true)
    public List<LeaveBalanceResponseDto> getLeaveBalance(Long employeeId) {
        getEmployee(employeeId);
        Map<String, BigDecimal> allotments = new LinkedHashMap<>();
        allotments.put("Casual Leave", BigDecimal.valueOf(12));
        allotments.put("Sick Leave", BigDecimal.valueOf(8));
        allotments.put("Paid Leave", BigDecimal.valueOf(15));
        allotments.put("Unpaid Leave", ZERO);

        settingRepository.findByTypeAndOrganizationIdAndIsDeletedFalseOrderByNameAsc(
                        LEAVE_TYPES,
                        currentOrganizationService.getOrganizationId()
                )
                .stream()
                .filter(setting -> setting.getStatus() == Status.ACTIVE)
                .map(StaffSetting::getName)
                .filter(StringUtils::hasText)
                .filter(name -> !containsIgnoreCase(allotments.keySet(), name))
                .forEach(name -> allotments.put(name, ZERO));

        List<LeaveBalanceResponseDto> balances = new ArrayList<>();
        allotments.forEach((leaveType, allotted) -> {
            BigDecimal used = defaultZero(leaveRepository.sumDaysByLeaveTypeAndStatus(
                    currentOrganizationService.getOrganizationId(),
                    employeeId,
                    leaveType,
                    StaffLeaveStatus.APPROVED
            ));
            BigDecimal remaining = allotted.subtract(used);
            if (remaining.compareTo(ZERO) < 0) {
                remaining = ZERO;
            }
            balances.add(LeaveBalanceResponseDto.builder()
                    .leaveType(leaveType)
                    .allotted(allotted)
                    .used(used)
                    .remaining(remaining)
                    .build());
        });
        return balances;
    }

    private StaffLeaveRequest getLeave(Long id) {
        return leaveRepository.findByIdAndOrganizationIdAndIsDeletedFalse(
                        id,
                        currentOrganizationService.getOrganizationId()
                )
                .orElseThrow(() -> new ResourceNotFoundException(
                        ErrorMessage.STAFF_LEAVE_NOT_FOUND,
                        "STAFF_LEAVE_NOT_FOUND"
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

    private LeaveResponseDto toResponse(StaffLeaveRequest leave) {
        Employee employee = leave.getEmployee();
        return LeaveResponseDto.builder()
                .id(leave.getId())
                .employeeId(employee.getId())
                .employeeCode(employee.getEmployeeCode())
                .employeeName(employee.getFirstName() + " " + employee.getLastName())
                .leaveType(leave.getLeaveType())
                .fromDate(leave.getFromDate())
                .toDate(leave.getToDate())
                .days(leave.getDays())
                .reason(leave.getReason())
                .status(leave.getStatus())
                .build();
    }

    private BigDecimal calculateDays(LocalDate fromDate, LocalDate toDate) {
        return BigDecimal.valueOf(ChronoUnit.DAYS.between(fromDate, toDate) + 1);
    }

    private Long resolveCurrentUserId() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof BillTopUserDetails userDetails)) {
            return null;
        }
        return userDetails.userId();
    }

    private boolean containsIgnoreCase(Collection<String> values, String candidate) {
        return values.stream().anyMatch(value -> value.equalsIgnoreCase(candidate));
    }

    private BigDecimal defaultZero(BigDecimal value) {
        return value == null ? ZERO : value;
    }
}
