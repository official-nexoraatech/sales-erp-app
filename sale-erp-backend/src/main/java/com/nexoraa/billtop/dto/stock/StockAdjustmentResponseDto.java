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
public class StockAdjustmentResponseDto {

    private Long adjustmentId;
    private String adjustmentNo;
    private NameIdResponseDto warehouse;
    private LocalDate adjustmentDate;
    private String reason;
    private List<StockAdjustmentItemResponseDto> items;
}
