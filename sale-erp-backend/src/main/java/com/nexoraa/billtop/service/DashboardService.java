package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.dashboard.DashboardSummaryResponseDto;

import java.time.LocalDate;

public interface DashboardService {

    DashboardSummaryResponseDto getSummary(LocalDate fromDate, LocalDate toDate);
}
