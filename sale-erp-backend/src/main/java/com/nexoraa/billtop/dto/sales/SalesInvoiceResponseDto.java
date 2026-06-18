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
public class SalesInvoiceResponseDto {

    private String invoiceNo;
    private String customerName;
    private BigDecimal grandTotal;
}
