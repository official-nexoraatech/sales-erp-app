package com.nexoraa.billtop.dto.stock;

import com.nexoraa.billtop.dto.common.NameIdResponseDto;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class StockTransferResponseDto {

    private Long transferId;
    private String transferNo;
    private NameIdResponseDto fromWarehouse;
    private NameIdResponseDto toWarehouse;
    private LocalDate transferDate;
    private String notes;
    private List<StockTransferItemResponseDto> items;
}
