package com.nexoraa.billtop.dto.sales;

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
public class SalesDetailResponseDto {

    private Long saleId;
    private String invoiceNo;
    private LocalDate invoiceDate;
    private NameIdResponseDto customer;
    private NameIdResponseDto warehouse;
    private BigDecimal subTotal;
    private BigDecimal discountAmount;
    private BigDecimal taxAmount;
    private BigDecimal roundOff;
    private BigDecimal grandTotal;
    private BigDecimal paidAmount;
    private BigDecimal dueAmount;
    private String status;
    private String notes;
    private List<SalesItemResponseDto> items;
}
