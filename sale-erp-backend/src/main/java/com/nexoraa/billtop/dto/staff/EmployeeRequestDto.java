package com.nexoraa.billtop.dto.staff;

import com.nexoraa.billtop.enums.EmploymentType;
import com.nexoraa.billtop.enums.Status;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
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
public class EmployeeRequestDto {

    @NotBlank(message = "Employee code is required")
    @Size(max = 50, message = "Employee code must be 50 characters or less")
    private String employeeCode;

    @NotBlank(message = "First name is required")
    @Size(max = 100, message = "First name must be 100 characters or less")
    private String firstName;

    @NotBlank(message = "Last name is required")
    @Size(max = 100, message = "Last name must be 100 characters or less")
    private String lastName;

    @Size(max = 20, message = "Gender must be 20 characters or less")
    private String gender;

    private LocalDate dob;

    @NotBlank(message = "Mobile is required")
    @Size(max = 20, message = "Mobile must be 20 characters or less")
    private String mobile;

    @NotBlank(message = "Email is required")
    @Email(message = "Email must be valid")
    @Size(max = 150, message = "Email must be 150 characters or less")
    private String email;

    private String address;

    @NotBlank(message = "Department is required")
    @Size(max = 100, message = "Department must be 100 characters or less")
    private String department;

    @NotBlank(message = "Designation is required")
    @Size(max = 100, message = "Designation must be 100 characters or less")
    private String designation;

    @NotNull(message = "Joining date is required")
    private LocalDate joiningDate;

    @NotNull(message = "Employment type is required")
    private EmploymentType employmentType;

    @Size(max = 150, message = "Reporting manager must be 150 characters or less")
    private String reportingManager;

    @DecimalMin(value = "0.00", message = "Basic salary must be zero or greater")
    private BigDecimal basicSalary;

    @DecimalMin(value = "0.00", message = "HRA must be zero or greater")
    private BigDecimal hra;

    @DecimalMin(value = "0.00", message = "Allowance must be zero or greater")
    private BigDecimal allowance;

    @DecimalMin(value = "0.00", message = "Deductions must be zero or greater")
    private BigDecimal deductions;

    @Size(max = 50, message = "Payment mode must be 50 characters or less")
    private String paymentMode;

    @Size(max = 150, message = "Bank name must be 150 characters or less")
    private String bankName;

    @Size(max = 50, message = "Account number must be 50 characters or less")
    private String accountNumber;

    @Size(max = 20, message = "IFSC code must be 20 characters or less")
    private String ifscCode;

    @Size(max = 150, message = "Account holder name must be 150 characters or less")
    private String accountHolderName;

    @NotNull(message = "Status is required")
    private Status status;
}
