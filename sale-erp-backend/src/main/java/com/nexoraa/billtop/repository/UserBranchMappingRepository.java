package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.UserBranchMapping;
import com.nexoraa.billtop.entity.UserBranchMappingId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.List;

public interface UserBranchMappingRepository extends JpaRepository<UserBranchMapping, UserBranchMappingId> {

    @Query("select mapping.branch.id from UserBranchMapping mapping where mapping.user.id = :userId")
    List<Long> findBranchIdsByUserId(@Param("userId") Long userId);

    @Query("select mapping from UserBranchMapping mapping where mapping.user.id in :userIds")
    List<UserBranchMapping> findByUserIdIn(@Param("userIds") Collection<Long> userIds);

    @Transactional
    void deleteByUser_Id(Long userId);
}
