package com.nexoraa.billtop.dto.staff;

import com.nexoraa.billtop.enums.EmploymentType;
import com.nexoraa.billtop.enums.Status;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class EmployeeResponseDto {

    private Long id;
    private String employeeCode;
    private String firstName;
    private String lastName;
    private String gender;
    private LocalDate dob;
    private String mobile;
    private String email;
    private String address;
    private String department;
    private String designation;
    private LocalDate joiningDate;
    private EmploymentType employmentType;
    private String reportingManager;
    private BigDecimal basicSalary;
    private BigDecimal hra;
    private BigDecimal allowance;
    private BigDecimal deductions;
    private String paymentMode;
    private String bankName;
    private String accountNumber;
    private String ifscCode;
    private String accountHolderName;
    private Status status;
    private LocalDateTime createdAt;
}
