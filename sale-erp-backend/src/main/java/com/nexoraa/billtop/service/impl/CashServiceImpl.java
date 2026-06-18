package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.dto.cash.CashSummaryResponseDto;
import com.nexoraa.billtop.dto.cash.CashTransactionResponseDto;
import com.nexoraa.billtop.repository.CashTransactionRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.CashService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class CashServiceImpl implements CashService {

    private final CashTransactionRepository cashTransactionRepository;
    private final FinanceSupport financeSupport;
    private final CurrentOrganizationService currentOrganizationService;

    public CashServiceImpl(
            CashTransactionRepository cashTransactionRepository,
            FinanceSupport financeSupport,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.cashTransactionRepository = cashTransactionRepository;
        this.financeSupport = financeSupport;
        this.currentOrganizationService = currentOrganizationService;
    }

    @Override
    @Transactional(readOnly = true)
    public CashSummaryResponseDto getSummary() {
        return financeSupport.cashSummary();
    }

    @Override
    @Transactional(readOnly = true)
    public List<CashTransactionResponseDto> getTransactions() {
        return cashTransactionRepository.findByOrganizationIdOrderByTransactionDateAscIdAsc(
                        currentOrganizationService.getOrganizationId()
                ).stream()
                .map(transaction -> CashTransactionResponseDto.builder()
                        .date(transaction.getTransactionDate())
                        .type(transaction.getTransactionType())
                        .amount(transaction.getAmount())
                        .build())
                .toList();
    }
}
