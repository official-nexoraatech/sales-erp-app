package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.StaffSetting;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface StaffSettingRepository extends JpaRepository<StaffSetting, Long> {

    List<StaffSetting> findByTypeAndOrganizationIdAndIsDeletedFalseOrderByNameAsc(String type, Long organizationId);

    Optional<StaffSetting> findByIdAndTypeAndOrganizationIdAndIsDeletedFalse(Long id, String type, Long organizationId);

    boolean existsByTypeAndNameIgnoreCaseAndOrganizationIdAndIsDeletedFalse(String type, String name, Long organizationId);

    boolean existsByTypeAndNameIgnoreCaseAndIdNotAndOrganizationIdAndIsDeletedFalse(
            String type,
            String name,
            Long id,
            Long organizationId
    );
}
