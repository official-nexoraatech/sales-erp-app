package com.nexoraa.billtop.dto.quotation;

import com.nexoraa.billtop.dto.common.NameIdResponseDto;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class QuotationDetailResponseDto {

    private Long quotationId;
    private String quotationNo;
    private LocalDate quotationDate;
    private LocalDate validUntil;
    private NameIdResponseDto customer;
    private NameIdResponseDto warehouse;
    private Long stateId;
    private Long salesPersonId;
    private BigDecimal subTotal;
    private BigDecimal discountAmount;
    private BigDecimal taxAmount;
    private BigDecimal roundOff;
    private BigDecimal grandTotal;
    private String status;
    private String notes;
    private Long convertedSaleId;
    private String convertedInvoiceNo;
    private List<QuotationItemResponseDto> items;
}
