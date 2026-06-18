package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.StaffEmployeeDocument;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface StaffEmployeeDocumentRepository extends JpaRepository<StaffEmployeeDocument, Long> {

    List<StaffEmployeeDocument> findByEmployeeIdAndOrganizationIdAndIsDeletedFalseOrderByCreatedAtDesc(
            Long employeeId,
            Long organizationId
    );

    Optional<StaffEmployeeDocument> findByIdAndEmployeeIdAndOrganizationIdAndIsDeletedFalse(
            Long id,
            Long employeeId,
            Long organizationId
    );
}
