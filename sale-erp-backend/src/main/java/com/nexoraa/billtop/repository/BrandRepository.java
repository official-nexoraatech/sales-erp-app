package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.entity.Brand;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.List;
import java.util.Optional;

public interface BrandRepository extends JpaRepository<Brand, Long>, JpaSpecificationExecutor<Brand> {

    boolean existsByNameIgnoreCaseAndCategory_IdAndStatusAndIsDeletedFalse(
            String name,
            Long categoryId,
            Status status
    );

    boolean existsByNameIgnoreCaseAndIdNotAndCategory_IdAndStatusAndIsDeletedFalse(
            String name,
            Long id,
            Long categoryId,
            Status status
    );

    Optional<Brand> findByIdAndCategory_IdAndStatusAndIsDeletedFalse(
            Long id,
            Long categoryId,
            Status status
    );

    Optional<Brand> findByIdAndStatusAndIsDeletedFalse(Long id, Status status);

    Optional<Brand> findByNameIgnoreCaseAndCategory_IdAndStatusAndIsDeletedFalse(
            String name,
            Long categoryId,
            Status status
    );

    List<Brand> findAllByCategory_IdAndStatusAndIsDeletedFalseOrderByNameAsc(
            Long categoryId,
            Status status
    );
}

