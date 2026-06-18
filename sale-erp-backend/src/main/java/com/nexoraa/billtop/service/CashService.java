package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.cash.CashSummaryResponseDto;
import com.nexoraa.billtop.dto.cash.CashTransactionResponseDto;

import java.util.List;

public interface CashService {

    CashSummaryResponseDto getSummary();

    List<CashTransactionResponseDto> getTransactions();
}
