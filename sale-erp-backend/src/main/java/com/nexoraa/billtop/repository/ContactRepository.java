package com.nexoraa.billtop.repository;

import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.entity.Contact;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.Optional;

public interface ContactRepository extends JpaRepository<Contact, Long>, JpaSpecificationExecutor<Contact> {

    Optional<Contact> findByIdAndContactTypeAndOrganizationIdAndStatus(
            Long id,
            String contactType,
            Long organizationId,
    Status status);

    long countByContactTypeAndOrganizationIdAndStatus(String contactType, Long organizationId, Status status);

    Optional<Contact> findFirstByContactTypeAndMobileAndOrganizationIdAndStatus(
            String contactType,
            String mobile,
            Long organizationId,
    Status status);

    Optional<Contact> findFirstByContactTypeAndEmailIgnoreCaseAndOrganizationIdAndStatus(
            String contactType,
            String email,
            Long organizationId,
    Status status);

    Optional<Contact> findFirstByContactTypeAndFirstNameIgnoreCaseAndLastNameIgnoreCaseAndOrganizationIdAndStatus(
            String contactType,
            String firstName,
            String lastName,
            Long organizationId,
    Status status);

    Optional<Contact> findFirstByContactTypeAndFirstNameIgnoreCaseAndOrganizationIdAndStatus(
            String contactType,
            String firstName,
            Long organizationId,
    Status status);
}


