package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.SalesPayment;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SalesPaymentRepository extends JpaRepository<SalesPayment, Long> {

    List<SalesPayment> findByPaymentId(Long paymentId);

    List<SalesPayment> findByPaymentIdAndOrganizationId(Long paymentId, Long organizationId);
}
