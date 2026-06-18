package com.nexoraa.billtop.specification;

import com.nexoraa.billtop.entity.Employee;
import com.nexoraa.billtop.entity.StaffAttendance;
import com.nexoraa.billtop.entity.StaffLeaveRequest;
import com.nexoraa.billtop.entity.StaffPayroll;
import com.nexoraa.billtop.enums.StaffAttendanceStatus;
import com.nexoraa.billtop.enums.StaffLeaveStatus;
import com.nexoraa.billtop.enums.Status;
import jakarta.persistence.criteria.Join;
import jakarta.persistence.criteria.Predicate;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.util.StringUtils;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

public final class StaffSpecification {

    private StaffSpecification() {
    }

    public static <T> Specification<T> organization(Long organizationId) {
        return (root, query, criteriaBuilder) -> criteriaBuilder.equal(root.get("organization").get("id"), organizationId);
    }

    public static <T> Specification<T> notDeleted() {
        return (root, query, criteriaBuilder) -> criteriaBuilder.isFalse(root.get("isDeleted"));
    }

    public static Specification<Employee> employeeSearch(String search) {
        return (root, query, criteriaBuilder) -> {
            if (!StringUtils.hasText(search)) {
                return criteriaBuilder.conjunction();
            }
            String pattern = "%" + search.trim().toLowerCase() + "%";
            return criteriaBuilder.or(
                    criteriaBuilder.like(criteriaBuilder.lower(root.get("employeeCode").as(String.class)), pattern),
                    criteriaBuilder.like(criteriaBuilder.lower(root.get("firstName").as(String.class)), pattern),
                    criteriaBuilder.like(criteriaBuilder.lower(root.get("lastName").as(String.class)), pattern),
                    criteriaBuilder.like(criteriaBuilder.lower(root.get("mobile").as(String.class)), pattern),
                    criteriaBuilder.like(criteriaBuilder.lower(root.get("email").as(String.class)), pattern)
            );
        };
    }

    public static Specification<Employee> employeeStatus(Status status) {
        return (root, query, criteriaBuilder) -> status == null
                ? criteriaBuilder.conjunction()
                : criteriaBuilder.equal(root.get("status"), status);
    }

    public static Specification<Employee> employeeDepartment(String department) {
        return (root, query, criteriaBuilder) -> StringUtils.hasText(department)
                ? criteriaBuilder.equal(criteriaBuilder.lower(root.get("department").as(String.class)), department.trim().toLowerCase())
                : criteriaBuilder.conjunction();
    }

    public static Specification<StaffAttendance> attendanceFilters(
            LocalDate date,
            String department,
            String employee,
            StaffAttendanceStatus status
    ) {
        return (root, query, criteriaBuilder) -> {
            List<Predicate> predicates = new ArrayList<>();
            Join<StaffAttendance, Employee> employeeJoin = root.join("employee");

            if (date != null) {
                predicates.add(criteriaBuilder.equal(root.get("attendanceDate"), date));
            }
            if (StringUtils.hasText(department)) {
                predicates.add(criteriaBuilder.equal(
                        criteriaBuilder.lower(employeeJoin.get("department").as(String.class)),
                        department.trim().toLowerCase()
                ));
            }
            if (StringUtils.hasText(employee)) {
                predicates.add(employeeSearchPredicate(employeeJoin, employee, criteriaBuilder));
            }
            if (status != null) {
                predicates.add(criteriaBuilder.equal(root.get("status"), status));
            }

            return criteriaBuilder.and(predicates.toArray(Predicate[]::new));
        };
    }

    public static Specification<StaffLeaveRequest> leaveFilters(
            String employee,
            String leaveType,
            StaffLeaveStatus status,
            LocalDate fromDate,
            LocalDate toDate
    ) {
        return (root, query, criteriaBuilder) -> {
            List<Predicate> predicates = new ArrayList<>();
            Join<StaffLeaveRequest, Employee> employeeJoin = root.join("employee");

            if (StringUtils.hasText(employee)) {
                predicates.add(employeeSearchPredicate(employeeJoin, employee, criteriaBuilder));
            }
            if (StringUtils.hasText(leaveType)) {
                predicates.add(criteriaBuilder.equal(
                        criteriaBuilder.lower(root.get("leaveType").as(String.class)),
                        leaveType.trim().toLowerCase()
                ));
            }
            if (status != null) {
                predicates.add(criteriaBuilder.equal(root.get("status"), status));
            }
            if (fromDate != null) {
                predicates.add(criteriaBuilder.greaterThanOrEqualTo(root.get("fromDate"), fromDate));
            }
            if (toDate != null) {
                predicates.add(criteriaBuilder.lessThanOrEqualTo(root.get("toDate"), toDate));
            }

            return criteriaBuilder.and(predicates.toArray(Predicate[]::new));
        };
    }

    public static Specification<StaffPayroll> payrollMonthFilter(String payrollMonth, String year, String month) {
        return (root, query, criteriaBuilder) -> {
            if (StringUtils.hasText(payrollMonth)) {
                return criteriaBuilder.equal(root.get("payrollMonth"), payrollMonth);
            }
            if (StringUtils.hasText(year)) {
                return criteriaBuilder.like(root.get("payrollMonth"), year + "-%");
            }
            if (StringUtils.hasText(month)) {
                return criteriaBuilder.like(root.get("payrollMonth"), "%-" + month);
            }
            return criteriaBuilder.conjunction();
        };
    }

    private static Predicate employeeSearchPredicate(
            Join<?, Employee> employeeJoin,
            String employee,
            jakarta.persistence.criteria.CriteriaBuilder criteriaBuilder
    ) {
        String pattern = "%" + employee.trim().toLowerCase() + "%";
        return criteriaBuilder.or(
                criteriaBuilder.like(criteriaBuilder.lower(employeeJoin.get("employeeCode").as(String.class)), pattern),
                criteriaBuilder.like(criteriaBuilder.lower(employeeJoin.get("firstName").as(String.class)), pattern),
                criteriaBuilder.like(criteriaBuilder.lower(employeeJoin.get("lastName").as(String.class)), pattern),
                criteriaBuilder.like(criteriaBuilder.lower(employeeJoin.get("mobile").as(String.class)), pattern),
                criteriaBuilder.like(criteriaBuilder.lower(employeeJoin.get("email").as(String.class)), pattern)
        );
    }
}
