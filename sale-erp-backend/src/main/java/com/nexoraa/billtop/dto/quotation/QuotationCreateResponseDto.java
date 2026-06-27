package com.nexoraa.billtop.dto.quotation;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class QuotationCreateResponseDto {

    private Long quotationId;
    private String quotationNo;
    private BigDecimal subTotal;
    private BigDecimal discountAmount;
    private BigDecimal taxAmount;
    private BigDecimal roundOff;
    private BigDecimal grandTotal;
    private String status;
}
