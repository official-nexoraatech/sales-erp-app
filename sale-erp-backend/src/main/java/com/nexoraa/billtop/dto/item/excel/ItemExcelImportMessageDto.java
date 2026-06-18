package com.nexoraa.billtop.dto.item.excel;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ItemExcelImportMessageDto {

    private String sheetName;
    private int rowNumber;
    private String itemName;
    private String message;
}
