package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.staff.PayrollRequestDto;
import com.nexoraa.billtop.dto.staff.PayrollResponseDto;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.service.StaffPayrollService;
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

import java.util.List;

@Validated
@RestController
@RequestMapping("/api/v1/staff/payroll")
public class StaffPayrollController {

    private final StaffPayrollService payrollService;

    public StaffPayrollController(StaffPayrollService payrollService) {
        this.payrollService = payrollService;
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<List<PayrollResponseDto>>> getPayroll(
            @RequestParam(required = false) String month,
            @RequestParam(required = false) String year
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.STAFF_PAYROLLS_RETRIEVED,
                payrollService.getPayroll(month, parseYear(year))
        ));
    }

    @PostMapping
    public ResponseEntity<ApiResponseDto<Void>> generatePayroll(@Valid @RequestBody PayrollRequestDto request) {
        payrollService.generatePayroll(request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.STAFF_PAYROLL_GENERATED));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponseDto<PayrollResponseDto>> getPayrollById(@PathVariable @Positive Long id) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.STAFF_PAYROLL_RETRIEVED,
                payrollService.getPayrollById(id)
        ));
    }

    @PutMapping("/{id}/mark-paid")
    public ResponseEntity<ApiResponseDto<Void>> markPaid(@PathVariable @Positive Long id) {
        payrollService.markPaid(id);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.STAFF_PAYROLL_MARKED_PAID));
    }

    private Integer parseYear(String year) {
        if (!StringUtils.hasText(year)) {
            return null;
        }
        try {
            int value = Integer.parseInt(year.trim());
            if (value < 1) {
                throw new NumberFormatException("Year out of range");
            }
            return value;
        } catch (NumberFormatException ex) {
            throw new BadRequestException(ErrorMessage.INVALID_YEAR, "INVALID_YEAR");
        }
    }
}
