package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.RolePermissionMapping;
import com.nexoraa.billtop.entity.RolePermissionMappingId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface RolePermissionMappingRepository extends JpaRepository<RolePermissionMapping, RolePermissionMappingId> {

    @Query("""
            select mapping
            from RolePermissionMapping mapping
            join fetch mapping.permission permission
            where mapping.role.id = :roleId
              and permission.status = com.nexoraa.billtop.enums.Status.ACTIVE
            """)
    List<RolePermissionMapping> findActivePermissionsByRoleId(@Param("roleId") Long roleId);
}

