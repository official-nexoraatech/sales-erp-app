package com.nexoraa.billtop.dto.staff;

import com.nexoraa.billtop.enums.StaffPayrollStatus;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
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
public class PayrollRequestDto {

    @NotNull(message = "Employee ID is required")
    private Long employeeId;

    @NotNull(message = "Payroll month is required")
    @Pattern(regexp = "^\\d{4}-(0[1-9]|1[0-2])$", message = "Payroll month must be in YYYY-MM format")
    private String payrollMonth;

    @DecimalMin(value = "0.00", message = "Basic salary must be zero or greater")
    private BigDecimal basicSalary;

    @DecimalMin(value = "0.00", message = "HRA must be zero or greater")
    private BigDecimal hra;

    @DecimalMin(value = "0.00", message = "Allowance must be zero or greater")
    private BigDecimal allowance;

    @DecimalMin(value = "0.00", message = "Overtime amount must be zero or greater")
    private BigDecimal overtimeAmount;

    @DecimalMin(value = "0.00", message = "Deductions must be zero or greater")
    private BigDecimal deductions;

    @DecimalMin(value = "0.00", message = "Tax must be zero or greater")
    private BigDecimal tax;

    private LocalDate paymentDate;

    private StaffPayrollStatus status;
}
