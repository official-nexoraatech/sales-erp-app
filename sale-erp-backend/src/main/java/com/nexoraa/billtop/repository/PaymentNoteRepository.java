package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.PaymentNote;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.Optional;

public interface PaymentNoteRepository extends JpaRepository<PaymentNote, Long>, JpaSpecificationExecutor<PaymentNote> {

    Optional<PaymentNote> findTopByNoteNoStartingWithAndOrganizationIdOrderByIdDesc(String prefix, Long organizationId);

    Optional<PaymentNote> findByIdAndOrganizationIdAndIsDeletedFalse(Long id, Long organizationId);
}
