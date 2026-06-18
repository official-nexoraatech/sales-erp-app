package com.nexoraa.billtop.mapper;

import com.nexoraa.billtop.dto.supplier.SupplierDetailResponseDto;
import com.nexoraa.billtop.dto.supplier.SupplierListResponseDto;
import com.nexoraa.billtop.dto.supplier.SupplierRequestDto;
import com.nexoraa.billtop.entity.Contact;
import org.mapstruct.Builder;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.MappingTarget;

@Mapper(componentModel = "spring", builder = @Builder(disableBuilder = true))
public interface SupplierMapper {

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "organization", ignore = true)
    @Mapping(target = "contactType", constant = "SUPPLIER")
    @Mapping(target = "phone", ignore = true)
    @Mapping(target = "whatsappNo", ignore = true)
    @Mapping(target = "panNumber", ignore = true)
    @Mapping(target = "openingBalanceType", constant = "PAYABLE")
    @Mapping(target = "isWholesale", constant = "false")
    @Mapping(target = "status", constant = "ACTIVE")
    @Mapping(target = "createdAt", ignore = true)
    @Mapping(target = "updatedAt", ignore = true)
    Contact toEntity(SupplierRequestDto request);

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "organization", ignore = true)
    @Mapping(target = "contactType", ignore = true)
    @Mapping(target = "phone", ignore = true)
    @Mapping(target = "whatsappNo", ignore = true)
    @Mapping(target = "panNumber", ignore = true)
    @Mapping(target = "openingBalanceType", ignore = true)
    @Mapping(target = "isWholesale", ignore = true)
    @Mapping(target = "status", ignore = true)
    @Mapping(target = "createdAt", ignore = true)
    @Mapping(target = "updatedAt", ignore = true)
    void updateEntity(SupplierRequestDto request, @MappingTarget Contact contact);

    @Mapping(target = "supplierCode", expression = "java(toSupplierCode(contact.getId()))")
    @Mapping(target = "currentBalance", source = "openingBalance")
    SupplierDetailResponseDto toDetailResponse(Contact contact);

    @Mapping(target = "supplierCode", expression = "java(toSupplierCode(contact.getId()))")
    @Mapping(target = "supplierName", expression = "java(toDisplayName(contact))")
    @Mapping(target = "balance", source = "openingBalance")
    SupplierListResponseDto toListResponse(Contact contact);

    default String toSupplierCode(Long id) {
        return id == null ? null : String.format("SUP%06d", id);
    }

    default String toDisplayName(Contact contact) {
        String firstName = contact.getFirstName() == null ? "" : contact.getFirstName().trim();
        String lastName = contact.getLastName() == null ? "" : contact.getLastName().trim();
        String fullName = (firstName + " " + lastName).trim();
        return fullName.isBlank() ? contact.getCompanyName() : fullName;
    }
}


