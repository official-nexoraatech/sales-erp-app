package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.entity.BankAccount;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface BankAccountRepository extends JpaRepository<BankAccount, Long> {

    List<BankAccount> findByStatusOrderByIdDesc(Status status);

    List<BankAccount> findByOrganizationIdAndStatusOrderByIdDesc(Long organizationId, Status status);

    Optional<BankAccount> findByIdAndStatus(Long id, Status status);

    Optional<BankAccount> findByIdAndOrganizationIdAndStatus(Long id, Long organizationId, Status status);

    Optional<BankAccount> findFirstByStatusOrderByIdAsc(Status status);

    Optional<BankAccount> findFirstByOrganizationIdAndStatusOrderByIdAsc(Long organizationId, Status status);
}

