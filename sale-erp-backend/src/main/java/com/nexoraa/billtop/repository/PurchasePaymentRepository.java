package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.PurchasePayment;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDate;
import java.util.List;

public interface PurchasePaymentRepository extends JpaRepository<PurchasePayment, Long> {

    List<PurchasePayment> findByPaymentId(Long paymentId);

    List<PurchasePayment> findByPaymentIdAndOrganizationId(Long paymentId, Long organizationId);

    List<PurchasePayment> findByOrganizationIdAndPayment_PaymentDateBetween(
            Long organizationId,
            LocalDate fromDate,
            LocalDate toDate
    );
}
