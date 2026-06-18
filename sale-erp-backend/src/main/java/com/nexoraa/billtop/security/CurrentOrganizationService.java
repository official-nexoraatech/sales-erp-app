package com.nexoraa.billtop.security;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.entity.Organization;
import com.nexoraa.billtop.exception.UnauthorizedException;
import com.nexoraa.billtop.repository.OrganizationRepository;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;

@Service
public class CurrentOrganizationService {

    private final OrganizationRepository organizationRepository;

    public CurrentOrganizationService(OrganizationRepository organizationRepository) {
        this.organizationRepository = organizationRepository;
    }

    public Long getOrganizationId() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof BillTopUserDetails userDetails)) {
            throw new UnauthorizedException(ErrorMessage.UNAUTHORIZED, "ORGANIZATION_CONTEXT_MISSING");
        }
        return userDetails.organizationId();
    }

    public Organization getOrganizationReference() {
        return organizationRepository.getReferenceById(getOrganizationId());
    }
}
