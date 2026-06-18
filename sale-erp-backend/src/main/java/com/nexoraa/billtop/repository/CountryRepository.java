package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.entity.Country;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface CountryRepository extends JpaRepository<Country, Long> {

    Optional<Country> findByIdAndStatus(Long id, Status status);

    List<Country> findAllByStatusAndIsDeletedFalseOrderByNameAsc(Status status);

    boolean existsByIdAndStatusAndIsDeletedFalse(Long id, Status status);
}

