package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.BankTransaction;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDate;
import java.util.List;

public interface BankTransactionRepository extends JpaRepository<BankTransaction, Long> {

    List<BankTransaction> findByBankAccountIdOrderByTransactionDateAscIdAsc(Long bankAccountId);

    List<BankTransaction> findByBankAccountIdAndOrganizationIdOrderByTransactionDateAscIdAsc(
            Long bankAccountId,
            Long organizationId
    );

    List<BankTransaction> findByTransactionDateOrderByIdAsc(LocalDate transactionDate);

    List<BankTransaction> findByTransactionDateAndOrganizationIdOrderByIdAsc(
            LocalDate transactionDate,
            Long organizationId
    );

    List<BankTransaction> findByPaymentId(Long paymentId);

    List<BankTransaction> findByPaymentIdAndOrganizationId(Long paymentId, Long organizationId);
}
