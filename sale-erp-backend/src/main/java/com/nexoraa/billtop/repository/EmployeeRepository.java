package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.Employee;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.Optional;

public interface EmployeeRepository extends JpaRepository<Employee, Long>, JpaSpecificationExecutor<Employee> {

    boolean existsByEmployeeCodeIgnoreCaseAndOrganizationIdAndIsDeletedFalse(String employeeCode, Long organizationId);

    boolean existsByEmployeeCodeIgnoreCaseAndIdNotAndOrganizationIdAndIsDeletedFalse(
            String employeeCode,
            Long id,
            Long organizationId
    );

    Optional<Employee> findByIdAndOrganizationIdAndIsDeletedFalse(Long id, Long organizationId);
}
