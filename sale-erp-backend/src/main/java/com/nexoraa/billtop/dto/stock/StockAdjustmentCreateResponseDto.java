package com.nexoraa.billtop.dto.stock;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class StockAdjustmentCreateResponseDto {

    private Long adjustmentId;
    private String adjustmentNo;
}
