package com.nexoraa.billtop.dto.contact.excel;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ContactExcelImportMessageDto {

    private String sheetName;
    private int rowNumber;
    private String contactName;
    private String message;
}
