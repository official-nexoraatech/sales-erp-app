package com.nexoraa.billtop.dto.stock;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class StockTransferCreateResponseDto {

    private Long transferId;
    private String transferNo;
}
