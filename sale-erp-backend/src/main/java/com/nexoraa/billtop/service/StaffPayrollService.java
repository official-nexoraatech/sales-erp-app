package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.staff.PayrollRequestDto;
import com.nexoraa.billtop.dto.staff.PayrollResponseDto;

import java.util.List;

public interface StaffPayrollService {

    List<PayrollResponseDto> getPayroll(String month, Integer year);

    void generatePayroll(PayrollRequestDto request);

    PayrollResponseDto getPayrollById(Long id);

    void markPaid(Long id);
}
