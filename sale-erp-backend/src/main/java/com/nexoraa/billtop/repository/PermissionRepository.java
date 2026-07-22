package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.Permission;
import com.nexoraa.billtop.enums.Status;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;

public interface PermissionRepository extends JpaRepository<Permission, Long> {

    List<Permission> findAllByIdInAndStatusAndIsDeletedFalse(Collection<Long> ids, Status status);

    List<Permission> findAllByStatusAndIsDeletedFalse(Status status);
}
