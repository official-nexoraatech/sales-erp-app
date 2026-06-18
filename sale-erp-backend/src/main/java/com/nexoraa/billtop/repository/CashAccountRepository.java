package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.entity.CashAccount;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface CashAccountRepository extends JpaRepository<CashAccount, Long> {

    Optional<CashAccount> findFirstByStatusOrderByIdAsc(Status status);

    Optional<CashAccount> findFirstByOrganizationIdAndStatusOrderByIdAsc(Long organizationId, Status status);
}

