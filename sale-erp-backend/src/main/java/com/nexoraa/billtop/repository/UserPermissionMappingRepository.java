package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.UserPermissionMapping;
import com.nexoraa.billtop.entity.UserPermissionMappingId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;

public interface UserPermissionMappingRepository extends JpaRepository<UserPermissionMapping, UserPermissionMappingId> {

    @Query("""
            select mapping
            from UserPermissionMapping mapping
            join fetch mapping.permission permission
            where mapping.user.id = :userId
              and mapping.user.isDeleted = false
              and mapping.user.status = com.nexoraa.billtop.enums.Status.ACTIVE
              and permission.isDeleted = false
              and permission.status = com.nexoraa.billtop.enums.Status.ACTIVE
            """)
    List<UserPermissionMapping> findActivePermissionsByUserId(@Param("userId") Long userId);

    @Query("""
            select mapping
            from UserPermissionMapping mapping
            where mapping.user.id = :userId
              and mapping.permission.id in :permissionIds
            """)
    List<UserPermissionMapping> findByUserIdAndPermissionIds(
            @Param("userId") Long userId,
            @Param("permissionIds") Collection<Long> permissionIds
    );

    @Modifying
    @Query("""
            delete from UserPermissionMapping mapping
            where mapping.user.id = :userId
            """)
    void deleteByUserId(@Param("userId") Long userId);
}
