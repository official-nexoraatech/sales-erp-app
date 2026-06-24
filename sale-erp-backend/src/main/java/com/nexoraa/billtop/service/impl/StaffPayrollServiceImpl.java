package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.staff.PayrollRequestDto;
import com.nexoraa.billtop.dto.staff.PayrollResponseDto;
import com.nexoraa.billtop.entity.Employee;
import com.nexoraa.billtop.entity.Organization;
import com.nexoraa.billtop.entity.StaffPayroll;
import com.nexoraa.billtop.enums.StaffPayrollStatus;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.repository.EmployeeRepository;
import com.nexoraa.billtop.repository.StaffPayrollRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.StaffPayrollService;
import com.nexoraa.billtop.specification.StaffSpecification;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

@Service
public class StaffPayrollServiceImpl implements StaffPayrollService {

    private static final BigDecimal ZERO = BigDecimal.ZERO;

    private final StaffPayrollRepository payrollRepository;
    private final EmployeeRepository employeeRepository;
    private final CurrentOrganizationService currentOrganizationService;

    public StaffPayrollServiceImpl(
            StaffPayrollRepository payrollRepository,
            EmployeeRepository employeeRepository,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.payrollRepository = payrollRepository;
        this.employeeRepository = employeeRepository;
        this.currentOrganizationService = currentOrganizationService;
    }

    @Override
    @Transactional(readOnly = true)
    public List<PayrollResponseDto> getPayroll(String month, Integer year) {
        String normalizedMonth = normalizeMonth(month);
        String yearValue = year == null ? null : String.valueOf(year);
        String payrollMonth = normalizedMonth != null && yearValue != null ? yearValue + "-" + normalizedMonth : null;
        Specification<StaffPayroll> specification = StaffSpecification.<StaffPayroll>organization(currentOrganizationService.getOrganizationId())
                .and(StaffSpecification.notDeleted())
                .and(StaffSpecification.payrollMonthFilter(payrollMonth, yearValue, normalizedMonth));
        return payrollRepository.findAll(specification, Sort.by(Sort.Direction.DESC, "payrollMonth", "id"))
                .stream()
                .map(this::toResponse)
                .toList();
    }

    @Override
    @Transactional
    public void generatePayroll(PayrollRequestDto request) {
        Organization organization = currentOrganizationService.getOrganizationReference();
        Long organizationId = organization.getId();
        Employee employee = getEmployee(request.getEmployeeId());
        StaffPayroll payroll = payrollRepository.findByOrganizationIdAndEmployeeIdAndPayrollMonthAndIsDeletedFalse(
                        organizationId,
                        request.getEmployeeId(),
                        request.getPayrollMonth()
                )
                .orElseGet(StaffPayroll::new);
        if (payroll.getId() == null) {
            payroll.setOrganization(organization);
            payroll.setEmployee(employee);
            payroll.setPayrollMonth(request.getPayrollMonth());
        }
        applyRequest(request, payroll);
        payrollRepository.save(payroll);
    }

    @Override
    @Transactional(readOnly = true)
    public PayrollResponseDto getPayrollById(Long id) {
        return toResponse(getPayrollRecord(id));
    }

    @Override
    @Transactional
    public void markPaid(Long id) {
        StaffPayroll payroll = getPayrollRecord(id);
        payroll.setStatus(StaffPayrollStatus.PAID);
        if (payroll.getPaymentDate() == null) {
            payroll.setPaymentDate(LocalDate.now());
        }
        payrollRepository.save(payroll);
    }

    private StaffPayroll getPayrollRecord(Long id) {
        return payrollRepository.findByIdAndOrganizationIdAndIsDeletedFalse(
                        id,
                        currentOrganizationService.getOrganizationId()
                )
                .orElseThrow(() -> new ResourceNotFoundException(
                        ErrorMessage.STAFF_PAYROLL_NOT_FOUND,
                        "STAFF_PAYROLL_NOT_FOUND"
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

    private void applyRequest(PayrollRequestDto request, StaffPayroll payroll) {
        BigDecimal basicSalary = defaultZero(request.getBasicSalary());
        BigDecimal hra = defaultZero(request.getHra());
        BigDecimal allowance = defaultZero(request.getAllowance());
        BigDecimal overtimeAmount = defaultZero(request.getOvertimeAmount());
        BigDecimal deductions = defaultZero(request.getDeductions());
        BigDecimal tax = defaultZero(request.getTax());
        BigDecimal grossPay = basicSalary.add(hra).add(allowance).add(overtimeAmount);
        BigDecimal netPay = grossPay.subtract(deductions).subtract(tax);

        payroll.setBasicSalary(basicSalary);
        payroll.setHra(hra);
        payroll.setAllowance(allowance);
        payroll.setOvertimeAmount(overtimeAmount);
        payroll.setDeductions(deductions);
        payroll.setTax(tax);
        payroll.setGrossPay(grossPay);
        payroll.setNetPay(netPay);
        payroll.setPaymentDate(request.getPaymentDate());
        payroll.setStatus(request.getStatus() == null ? StaffPayrollStatus.GENERATED : request.getStatus());
    }

    private PayrollResponseDto toResponse(StaffPayroll payroll) {
        Employee employee = payroll.getEmployee();
        return PayrollResponseDto.builder()
                .id(payroll.getId())
                .employeeId(employee.getId())
                .employeeCode(employee.getEmployeeCode())
                .employeeName(employee.getFirstName() + " " + employee.getLastName())
                .payrollMonth(payroll.getPayrollMonth())
                .basicSalary(defaultZero(payroll.getBasicSalary()))
                .hra(defaultZero(payroll.getHra()))
                .allowance(defaultZero(payroll.getAllowance()))
                .overtimeAmount(defaultZero(payroll.getOvertimeAmount()))
                .deductions(defaultZero(payroll.getDeductions()))
                .tax(defaultZero(payroll.getTax()))
                .grossPay(defaultZero(payroll.getGrossPay()))
                .netPay(defaultZero(payroll.getNetPay()))
                .paymentDate(payroll.getPaymentDate())
                .status(payroll.getStatus())
                .build();
    }

    private String normalizeMonth(String month) {
        if (!StringUtils.hasText(month)) {
            return null;
        }
        try {
            int monthNumber = Integer.parseInt(month.trim());
            if (monthNumber < 1 || monthNumber > 12) {
                throw new NumberFormatException("Month out of range");
            }
            return String.format("%02d", monthNumber);
        } catch (NumberFormatException ex) {
            throw new BadRequestException(ErrorMessage.INVALID_MONTH, "INVALID_MONTH");
        }
    }

    private BigDecimal defaultZero(BigDecimal value) {
        return value == null ? ZERO : value;
    }
}
