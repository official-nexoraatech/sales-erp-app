package com.nexoraa.billtop.dto.staff;

import com.nexoraa.billtop.enums.StaffPayrollStatus;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PayrollResponseDto {

    private Long id;
    private Long employeeId;
    private String employeeCode;
    private String employeeName;
    private String payrollMonth;
    private BigDecimal basicSalary;
    private BigDecimal hra;
    private BigDecimal allowance;
    private BigDecimal overtimeAmount;
    private BigDecimal deductions;
    private BigDecimal tax;
    private BigDecimal grossPay;
    private BigDecimal netPay;
    private LocalDate paymentDate;
    private StaffPayrollStatus status;
}
