package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.UserEmailAccount;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface UserEmailAccountRepository extends JpaRepository<UserEmailAccount, Long> {

    Optional<UserEmailAccount> findByUserIdAndIsDeletedFalse(Long userId);
}
