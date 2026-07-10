package com.nexoraa.billtop.dto.report;

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
public class GstReportResponseDto {

    private LocalDate date;
    private String invoiceNo;
    private String partyName;
    private String gstin;
    private String transactionType;
    private BigDecimal taxableAmount;
    private BigDecimal taxRate;
    private BigDecimal cgst;
    private BigDecimal sgst;
    private BigDecimal igst;
    private BigDecimal taxAmount;
    private BigDecimal grandTotal;
}
