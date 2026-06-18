package com.nexoraa.billtop.dto.returning;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ReturnItemResponseDto {

    private Long itemId;
    private String itemName;
    private Long batchId;
    private String batchNo;
    private BigDecimal quantity;
    private BigDecimal rate;
    private BigDecimal amount;
}
