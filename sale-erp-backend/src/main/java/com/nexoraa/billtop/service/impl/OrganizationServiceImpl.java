package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.common.FileUploadResponseDto;
import com.nexoraa.billtop.dto.organization.OrganizationAddressRequestDto;
import com.nexoraa.billtop.dto.organization.OrganizationRequestDto;
import com.nexoraa.billtop.dto.organization.OrganizationResponseDto;
import com.nexoraa.billtop.entity.Address;
import com.nexoraa.billtop.entity.Country;
import com.nexoraa.billtop.entity.Organization;
import com.nexoraa.billtop.entity.State;
import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.mapper.OrganizationMapper;
import com.nexoraa.billtop.repository.AddressRepository;
import com.nexoraa.billtop.repository.CountryRepository;
import com.nexoraa.billtop.repository.OrganizationRepository;
import com.nexoraa.billtop.repository.StateRepository;
import com.nexoraa.billtop.service.FileStorageService;
import com.nexoraa.billtop.service.OrganizationService;
import com.nexoraa.billtop.specification.MasterDataSpecification;
import jakarta.persistence.criteria.Join;
import jakarta.persistence.criteria.JoinType;
import jakarta.persistence.criteria.Predicate;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

import java.util.ArrayList;
import java.util.List;

@Service
public class OrganizationServiceImpl implements OrganizationService {

    private static final String ORGANIZATION_ADDRESS = "ORGANIZATION";

    private final OrganizationRepository organizationRepository;
    private final AddressRepository addressRepository;
    private final StateRepository stateRepository;
    private final CountryRepository countryRepository;
    private final OrganizationMapper organizationMapper;
    private final FileStorageService fileStorageService;

    public OrganizationServiceImpl(
            OrganizationRepository organizationRepository,
            AddressRepository addressRepository,
            StateRepository stateRepository,
            CountryRepository countryRepository,
            OrganizationMapper organizationMapper,
            FileStorageService fileStorageService
    ) {
        this.organizationRepository = organizationRepository;
        this.addressRepository = addressRepository;
        this.stateRepository = stateRepository;
        this.countryRepository = countryRepository;
        this.organizationMapper = organizationMapper;
        this.fileStorageService = fileStorageService;
    }

    @Override
    @Transactional
    public void createOrganization(OrganizationRequestDto request) {
        if (organizationRepository.existsByNameIgnoreCaseAndStatus(request.getName(), Status.ACTIVE)) {
            throw new BadRequestException(ErrorMessage.ORGANIZATION_ALREADY_EXISTS, "ORGANIZATION_ALREADY_EXISTS");
        }
        Organization organization = organizationRepository.save(organizationMapper.toEntity(request));
        saveAddress(organization, request.getAddress());
    }

    @Override
    @Transactional(readOnly = true)
    public List<OrganizationResponseDto> getOrganizations(String search) {
        Specification<Organization> specification = MasterDataSpecification.<Organization>active()
                .and((root, query, criteriaBuilder) -> criteriaBuilder.isFalse(root.get("isDeleted")))
                .and(search(search));
        return organizationRepository.findAll(specification, Sort.by(Sort.Direction.ASC, "name"))
                .stream()
                .map(organizationMapper::toResponse)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public OrganizationResponseDto getOrganizationById(Long id) {
        return organizationMapper.toResponse(getActiveOrganization(id));
    }

    @Override
    @Transactional
    public void updateOrganization(Long id, OrganizationRequestDto request) {
        Organization organization = getActiveOrganization(id);
        if (organizationRepository.existsByNameIgnoreCaseAndIdNotAndStatus(request.getName(), id, Status.ACTIVE)) {
            throw new BadRequestException(ErrorMessage.ORGANIZATION_ALREADY_EXISTS, "ORGANIZATION_ALREADY_EXISTS");
        }
        organizationMapper.updateEntity(request, organization);
        organizationRepository.save(organization);
        saveAddress(organization, request.getAddress());
    }

    @Override
    @Transactional
    public FileUploadResponseDto uploadOrganizationLogo(Long id, MultipartFile file) {
        Organization organization = getActiveOrganization(id);
        FileUploadResponseDto upload = fileStorageService.uploadImage(file, "organizations/" + organization.getId());
        organization.setLogoUrl(upload.getObjectUrl());
        organizationRepository.save(organization);
        return upload;
    }

    @Override
    @Transactional
    public void deleteOrganization(Long id) {
        Organization organization = getActiveOrganization(id);
        organization.setStatus(Status.INACTIVE);
        organization.setIsDeleted(true);
        organizationRepository.save(organization);
    }

    private Organization getActiveOrganization(Long id) {
        return organizationRepository.findByIdAndStatusAndIsDeletedFalse(id, Status.ACTIVE)
                .orElseThrow(() -> new ResourceNotFoundException(
                        ErrorMessage.ORGANIZATION_NOT_FOUND,
                        "ORGANIZATION_NOT_FOUND"
                ));
    }

    private void saveAddress(Organization organization, OrganizationAddressRequestDto request) {
        if (request == null) {
            return;
        }

        Address address = organization.getAddress();
        if (address == null) {
            address = addressRepository.findFirstByOrganizationIdAndContactIsNullAndAddressType(
                            organization.getId(),
                            ORGANIZATION_ADDRESS
                    )
                    .orElseGet(Address::new);
        }

        address.setOrganization(organization);
        address.setContact(null);
        address.setAddressType(ORGANIZATION_ADDRESS);
        address.setAddressLine1(request.getAddressLine1());
        address.setAddressLine2(request.getAddressLine2());
        address.setCity(request.getCity());
        address.setState(getActiveState(request.getStateId()));
        address.setCountry(getActiveCountry(request.getCountryId()));
        address.setPincode(request.getPincode());

        Address savedAddress = addressRepository.save(address);
        if (organization.getAddress() == null || !savedAddress.getId().equals(organization.getAddress().getId())) {
            organization.setAddress(savedAddress);
            organizationRepository.save(organization);
        }
    }

    private State getActiveState(Long id) {
        return stateRepository.findByIdAndStatus(id, Status.ACTIVE)
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.STATE_NOT_FOUND, "STATE_NOT_FOUND"));
    }

    private Country getActiveCountry(Long id) {
        return countryRepository.findByIdAndStatus(id, Status.ACTIVE)
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.COUNTRY_NOT_FOUND, "COUNTRY_NOT_FOUND"));
    }

    private Specification<Organization> search(String search) {
        return (root, query, criteriaBuilder) -> {
            if (!StringUtils.hasText(search)) {
                return criteriaBuilder.conjunction();
            }

            String pattern = "%" + search.trim().toLowerCase() + "%";
            Join<Organization, Address> address = root.join("address", JoinType.LEFT);
            List<Predicate> predicates = new ArrayList<>();
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.get("name").as(String.class)), pattern));
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.get("description").as(String.class)), pattern));
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(address.get("addressLine1").as(String.class)), pattern));
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(address.get("addressLine2").as(String.class)), pattern));
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(address.get("city").as(String.class)), pattern));
            predicates.add(criteriaBuilder.like(criteriaBuilder.lower(address.get("pincode").as(String.class)), pattern));
            return criteriaBuilder.or(predicates.toArray(Predicate[]::new));
        };
    }
}


