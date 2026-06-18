package com.nexoraa.billtop.dto.sales;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SalesReturnCreateResponseDto {

    private Long returnId;
    private String returnNo;
    private BigDecimal grandTotal;
}
