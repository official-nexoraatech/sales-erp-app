package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.entity.Address;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface AddressRepository extends JpaRepository<Address, Long> {

    List<Address> findByContactIdAndOrganizationId(Long contactId, Long organizationId);

    Optional<Address> findFirstByOrganizationIdAndContactIsNullAndAddressType(Long organizationId, String addressType);

    Optional<Address> findByContactIdAndAddressTypeAndOrganizationId(
            Long contactId,
            String addressType,
            Long organizationId
    );
}
