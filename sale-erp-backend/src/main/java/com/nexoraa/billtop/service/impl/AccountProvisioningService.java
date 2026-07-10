package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.entity.BankAccount;
import com.nexoraa.billtop.entity.CashAccount;
import com.nexoraa.billtop.entity.Organization;
import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.repository.BankAccountRepository;
import com.nexoraa.billtop.repository.CashAccountRepository;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;

/**
 * Provisions default cash/bank accounts in their own writable transaction so that
 * lazily creating them never gets attempted inside a caller's read-only transaction.
 */
@Component
class AccountProvisioningService {

    private final CashAccountRepository cashAccountRepository;
    private final BankAccountRepository bankAccountRepository;

    AccountProvisioningService(
            CashAccountRepository cashAccountRepository,
            BankAccountRepository bankAccountRepository
    ) {
        this.cashAccountRepository = cashAccountRepository;
        this.bankAccountRepository = bankAccountRepository;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    CashAccount getOrCreateCashAccount(Organization organization) {
        return cashAccountRepository.findFirstByOrganizationIdAndStatusOrderByIdAsc(organization.getId(), Status.ACTIVE)
                .orElseGet(() -> cashAccountRepository.save(CashAccount.builder()
                        .organization(organization)
                        .accountName("Cash In Hand")
                        .openingBalance(BigDecimal.ZERO)
                        .status(Status.ACTIVE)
                        .build()));
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    BankAccount getDefaultBankAccount(Organization organization) {
        return bankAccountRepository.findFirstByOrganizationIdAndStatusOrderByIdAsc(organization.getId(), Status.ACTIVE)
                .orElseGet(() -> bankAccountRepository.save(BankAccount.builder()
                        .organization(organization)
                        .bankName("Default Bank")
                        .accountName("Default Bank Account")
                        .openingBalance(BigDecimal.ZERO)
                        .status(Status.ACTIVE)
                        .build()));
    }
}
