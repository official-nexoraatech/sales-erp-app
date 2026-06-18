package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.CashTransaction;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDate;
import java.util.List;

public interface CashTransactionRepository extends JpaRepository<CashTransaction, Long> {

    List<CashTransaction> findAllByOrderByTransactionDateAscIdAsc();

    List<CashTransaction> findByOrganizationIdOrderByTransactionDateAscIdAsc(Long organizationId);

    List<CashTransaction> findByTransactionDateOrderByIdAsc(LocalDate transactionDate);

    List<CashTransaction> findByTransactionDateAndOrganizationIdOrderByIdAsc(LocalDate transactionDate, Long organizationId);

    List<CashTransaction> findByPaymentId(Long paymentId);

    List<CashTransaction> findByPaymentIdAndOrganizationId(Long paymentId, Long organizationId);
}
