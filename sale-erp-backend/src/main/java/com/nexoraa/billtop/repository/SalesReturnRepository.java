package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.SalesReturn;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface SalesReturnRepository extends JpaRepository<SalesReturn, Long> {

    Optional<SalesReturn> findTopByOrderByIdDesc();

    Optional<SalesReturn> findTopByOrganizationIdOrderByIdDesc(Long organizationId);

    List<SalesReturn> findByCustomerIdOrderByReturnDateAscIdAsc(Long customerId);

    List<SalesReturn> findByCustomerIdAndOrganizationIdOrderByReturnDateAscIdAsc(Long customerId, Long organizationId);

    Optional<SalesReturn> findByIdAndOrganizationId(Long id, Long organizationId);

    Page<SalesReturn> findByOrganizationId(Long organizationId, Pageable pageable);
}
