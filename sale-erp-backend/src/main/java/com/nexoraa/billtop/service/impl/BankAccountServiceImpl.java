package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.dto.bank.BankAccountCreateResponseDto;
import com.nexoraa.billtop.dto.bank.BankAccountRequestDto;
import com.nexoraa.billtop.dto.bank.BankAccountResponseDto;
import com.nexoraa.billtop.dto.bank.BankLedgerResponseDto;
import com.nexoraa.billtop.dto.bank.BankTransactionResponseDto;
import com.nexoraa.billtop.entity.BankAccount;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.repository.BankAccountRepository;
import com.nexoraa.billtop.repository.BankTransactionRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.BankAccountService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class BankAccountServiceImpl implements BankAccountService {

    private final BankAccountRepository bankAccountRepository;
    private final BankTransactionRepository bankTransactionRepository;
    private final TransactionSupport support;
    private final FinanceSupport financeSupport;
    private final CurrentOrganizationService currentOrganizationService;

    public BankAccountServiceImpl(
            BankAccountRepository bankAccountRepository,
            BankTransactionRepository bankTransactionRepository,
            TransactionSupport support,
            FinanceSupport financeSupport,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.bankAccountRepository = bankAccountRepository;
        this.bankTransactionRepository = bankTransactionRepository;
        this.support = support;
        this.financeSupport = financeSupport;
        this.currentOrganizationService = currentOrganizationService;
    }

    @Override
    @Transactional
    public BankAccountCreateResponseDto createBankAccount(BankAccountRequestDto request) {
        BankAccount bankAccount = bankAccountRepository.save(BankAccount.builder()
                .organization(currentOrganizationService.getOrganizationReference())
                .bankName(request.getBankName())
                .accountName(request.getAccountName())
                .accountNumber(request.getAccountNumber())
                .ifscCode(request.getIfscCode())
                .branchName(request.getBranchName())
                .openingBalance(support.money(request.getOpeningBalance()))
                .status(com.nexoraa.billtop.enums.Status.ACTIVE)
                .build());
        return BankAccountCreateResponseDto.builder()
                .bankAccountId(bankAccount.getId())
                .build();
    }

    @Override
    @Transactional(readOnly = true)
    public List<BankAccountResponseDto> getBankAccounts() {
        return bankAccountRepository.findByOrganizationIdAndStatusOrderByIdDesc(
                        currentOrganizationService.getOrganizationId(),
                com.nexoraa.billtop.enums.Status.ACTIVE).stream()
                .map(this::toResponse)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public BankLedgerResponseDto getBankTransactions(Long bankAccountId) {
        BankAccount bankAccount = bankAccountRepository.findByIdAndOrganizationIdAndStatus(
                        bankAccountId,
                        currentOrganizationService.getOrganizationId(),
                com.nexoraa.billtop.enums.Status.ACTIVE)
                .orElseThrow(() -> new ResourceNotFoundException("Bank account not found", "BANK_ACCOUNT_NOT_FOUND"));
        return BankLedgerResponseDto.builder()
                .currentBalance(financeSupport.bankBalance(bankAccount))
                .transactions(bankTransactionRepository.findByBankAccountIdAndOrganizationIdOrderByTransactionDateAscIdAsc(
                                bankAccountId,
                                currentOrganizationService.getOrganizationId()
                        ).stream()
                        .map(transaction -> BankTransactionResponseDto.builder()
                                .date(transaction.getTransactionDate())
                                .type(transaction.getTransactionType())
                                .amount(transaction.getAmount())
                                .build())
                        .toList())
                .build();
    }

    private BankAccountResponseDto toResponse(BankAccount bankAccount) {
        return BankAccountResponseDto.builder()
                .bankAccountId(bankAccount.getId())
                .bankName(bankAccount.getBankName())
                .accountName(bankAccount.getAccountName())
                .accountNumber(bankAccount.getAccountNumber())
                .ifscCode(bankAccount.getIfscCode())
                .branchName(bankAccount.getBranchName())
                .openingBalance(bankAccount.getOpeningBalance())
                .currentBalance(financeSupport.bankBalance(bankAccount))
                .build();
    }
}





