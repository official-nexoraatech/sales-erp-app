package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.entity.State;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface StateRepository extends JpaRepository<State, Long> {

    Optional<State> findByIdAndStatus(Long id, Status status);

    Optional<State> findFirstByStateNameIgnoreCaseAndStatus(String stateName, Status status);

    List<State> findAllByStatusAndIsDeletedFalseOrderByStateNameAsc(Status status);

    List<State> findAllByCountry_IdAndStatusAndIsDeletedFalseOrderByStateNameAsc(Long countryId, Status status);
}

