package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.StockTransaction;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDateTime;
import java.util.List;

public interface StockTransactionRepository extends JpaRepository<StockTransaction, Long> {

    List<StockTransaction> findByOrganizationIdAndTransactionDateBetweenOrderByTransactionDateAscIdAsc(
            Long organizationId,
            LocalDateTime fromDateTime,
            LocalDateTime toDateTime
    );
}
