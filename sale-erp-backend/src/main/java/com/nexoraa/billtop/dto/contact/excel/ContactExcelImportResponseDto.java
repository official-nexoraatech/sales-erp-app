package com.nexoraa.billtop.dto.contact.excel;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ContactExcelImportResponseDto {

    private int contactRows;
    private int createdContacts;
    private int updatedContacts;
    private int billingAddressRows;
    private int shippingAddressRows;
    private int failedRows;

    @Builder.Default
    private List<ContactExcelImportMessageDto> warnings = new ArrayList<>();

    @Builder.Default
    private List<ContactExcelImportMessageDto> errors = new ArrayList<>();
}
