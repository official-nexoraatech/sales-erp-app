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
public class SalesCreateResponseDto {

    private Long saleId;
    private String invoiceNo;
    private BigDecimal subTotal;
    private BigDecimal discountAmount;
    private BigDecimal taxAmount;
    private BigDecimal roundOff;
    private BigDecimal grandTotal;
    private BigDecimal paidAmount;
    private BigDecimal dueAmount;
}
