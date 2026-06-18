package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.User;
import com.nexoraa.billtop.enums.Status;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface UserRepository extends JpaRepository<User, Long> {

    @EntityGraph(attributePaths = {"role", "organization"})
    Optional<User> findByUserName(String userName);

    Optional<User> findByIdAndOrganizationId(Long id, Long organizationId);

    @EntityGraph(attributePaths = {"role", "organization"})
    Optional<User> findByUserNameAndOrganizationIdAndStatusAndIsDeletedFalse(
            String userName,
            Long organizationId,
            Status status
    );

    @EntityGraph(attributePaths = {"role", "organization"})
    Optional<User> findByIdAndOrganizationIdAndStatusAndIsDeletedFalse(Long id, Long organizationId, Status status);

    @EntityGraph(attributePaths = {"role", "organization"})
    @Query("""
            SELECT u
            FROM User u
            WHERE u.organization.id = :organizationId
              AND u.isDeleted = false
              AND (
                    :search IS NULL
                    OR LOWER(u.firstName) LIKE :search
                    OR LOWER(u.lastName) LIKE :search
                    OR LOWER(u.userName) LIKE :search
                    OR LOWER(u.email) LIKE :search
                    OR LOWER(u.mobileNo) LIKE :search
                  )
            ORDER BY u.firstName ASC, u.lastName ASC, u.id ASC
            """)
    List<User> findUsersByOrganization(
            @Param("organizationId") Long organizationId,
            @Param("search") String search
    );

    boolean existsByUserName(String userName);

    boolean existsByEmail(String email);

    boolean existsByUserNameAndIdNot(String userName, Long id);

    boolean existsByEmailAndIdNot(String email, Long id);
}
