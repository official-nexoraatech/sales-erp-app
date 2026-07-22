package com.nexoraa.billtop.mapper;

import com.nexoraa.billtop.dto.customer.CustomerAddressRequestDto;
import com.nexoraa.billtop.dto.customer.CustomerAddressResponseDto;
import com.nexoraa.billtop.dto.customer.CustomerDetailResponseDto;
import com.nexoraa.billtop.dto.customer.CustomerListResponseDto;
import com.nexoraa.billtop.dto.customer.CustomerRequestDto;
import com.nexoraa.billtop.entity.Contact;
import com.nexoraa.billtop.entity.Address;
import org.mapstruct.Builder;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.MappingTarget;

@Mapper(componentModel = "spring", builder = @Builder(disableBuilder = true))
public interface CustomerMapper {

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "organization", ignore = true)
    @Mapping(target = "branch", ignore = true)
    @Mapping(target = "contactType", constant = "CUSTOMER")
    @Mapping(target = "status", constant = "ACTIVE")
    @Mapping(target = "isWholesale", source = "isWholesale", defaultValue = "false")
    @Mapping(target = "createdAt", ignore = true)
    @Mapping(target = "updatedAt", ignore = true)
    Contact toEntity(CustomerRequestDto request);

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "organization", ignore = true)
    @Mapping(target = "branch", ignore = true)
    @Mapping(target = "contactType", ignore = true)
    @Mapping(target = "status", ignore = true)
    @Mapping(target = "isWholesale", source = "isWholesale", defaultValue = "false")
    @Mapping(target = "createdAt", ignore = true)
    @Mapping(target = "updatedAt", ignore = true)
    void updateEntity(CustomerRequestDto request, @MappingTarget Contact contact);

    @Mapping(target = "customerCode", expression = "java(toCustomerCode(contact.getId()))")
    @Mapping(target = "currentBalance", source = "openingBalance")
    @Mapping(target = "billingAddress", ignore = true)
    @Mapping(target = "shippingAddress", ignore = true)
    CustomerDetailResponseDto toDetailResponse(Contact contact);

    @Mapping(target = "customerCode", expression = "java(toCustomerCode(contact.getId()))")
    @Mapping(target = "customerName", expression = "java(toDisplayName(contact))")
    @Mapping(target = "balance", source = "openingBalance")
    CustomerListResponseDto toListResponse(Contact contact);

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "organization", ignore = true)
    @Mapping(target = "contact", ignore = true)
    @Mapping(target = "addressType", ignore = true)
    @Mapping(target = "state", ignore = true)
    @Mapping(target = "createdAt", ignore = true)
    Address toAddressEntity(CustomerAddressRequestDto request);

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "organization", ignore = true)
    @Mapping(target = "contact", ignore = true)
    @Mapping(target = "addressType", ignore = true)
    @Mapping(target = "state", ignore = true)
    @Mapping(target = "createdAt", ignore = true)
    void updateAddressEntity(CustomerAddressRequestDto request, @MappingTarget Address address);

    @Mapping(target = "stateId", source = "state.id")
    @Mapping(target = "stateName", source = "state.stateName")
    CustomerAddressResponseDto toAddressResponse(Address address);

    default String toCustomerCode(Long id) {
        return id == null ? null : String.format("CUS%06d", id);
    }

    default String toDisplayName(Contact contact) {
        String firstName = contact.getFirstName() == null ? "" : contact.getFirstName().trim();
        String lastName = contact.getLastName() == null ? "" : contact.getLastName().trim();
        String fullName = (firstName + " " + lastName).trim();
        return fullName.isBlank() ? toCustomerCode(contact.getId()) : fullName;
    }
}


