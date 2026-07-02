package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.Payment;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

public interface PaymentRepository extends JpaRepository<Payment, Long> {

    List<Payment> findByContactIdOrderByPaymentDateAscIdAsc(Long contactId);

    List<Payment> findByContactIdAndOrganizationIdOrderByPaymentDateAscIdAsc(Long contactId, Long organizationId);

    Optional<Payment> findTopByPaymentNoStartingWithOrderByIdDesc(String prefix);

    Optional<Payment> findTopByPaymentNoStartingWithAndOrganizationIdOrderByIdDesc(String prefix, Long organizationId);

    Page<Payment> findByPaymentTypeOrderByIdDesc(String paymentType, Pageable pageable);

    Page<Payment> findByPaymentTypeAndOrganizationIdOrderByIdDesc(
            String paymentType,
            Long organizationId,
            Pageable pageable
    );

    Page<Payment> findByPaymentTypeAndOrganizationIdAndIsDeletedFalseOrderByIdDesc(
            String paymentType,
            Long organizationId,
            Pageable pageable
    );

    List<Payment> findByPaymentDateAndPaymentTypeIn(LocalDate paymentDate, List<String> paymentTypes);

    List<Payment> findByPaymentDateAndPaymentTypeInAndOrganizationId(
            LocalDate paymentDate,
            List<String> paymentTypes,
            Long organizationId
    );

    Optional<Payment> findByReferenceNoAndPaymentType(String referenceNo, String paymentType);

    Optional<Payment> findByReferenceNoAndPaymentTypeAndOrganizationId(
            String referenceNo,
            String paymentType,
            Long organizationId
    );

    Optional<Payment> findByIdAndOrganizationId(Long id, Long organizationId);

    Optional<Payment> findByIdAndOrganizationIdAndIsDeletedFalse(Long id, Long organizationId);
}
