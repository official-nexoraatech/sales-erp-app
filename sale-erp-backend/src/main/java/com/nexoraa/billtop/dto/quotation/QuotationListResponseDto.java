package com.nexoraa.billtop.dto.quotation;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class QuotationListResponseDto {

    private Long quotationId;
    private String quotationNo;
    private LocalDate quotationDate;
    private LocalDate validUntil;
    private String customerName;
    private BigDecimal grandTotal;
    private String status;
    private Long convertedSaleId;
    private String convertedInvoiceNo;
}
