package com.nexoraa.billtop.dto.item.excel;

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
public class ItemExcelImportResponseDto {

    private int itemRows;
    private int batchRows;
    private int createdItems;
    private int updatedItems;
    private int createdBatches;
    private int updatedBatches;
    private int stockRowsUpdated;
    private int failedRows;

    @Builder.Default
    private List<ItemExcelImportMessageDto> warnings = new ArrayList<>();

    @Builder.Default
    private List<ItemExcelImportMessageDto> errors = new ArrayList<>();
}
