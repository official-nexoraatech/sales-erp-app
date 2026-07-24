package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.PaymentNoteAudit;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface PaymentNoteAuditRepository extends JpaRepository<PaymentNoteAudit, Long> {

    List<PaymentNoteAudit> findByPaymentNoteIdAndOrganizationIdOrderByIdDesc(Long paymentNoteId, Long organizationId);
}
