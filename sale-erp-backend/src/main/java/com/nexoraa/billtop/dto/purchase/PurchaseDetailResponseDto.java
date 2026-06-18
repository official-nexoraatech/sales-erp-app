package com.nexoraa.billtop.dto.purchase;

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
public class PurchaseDetailResponseDto {

    private Long purchaseId;
    private String purchaseNo;
    private LocalDate purchaseDate;
    private String referenceNo;
    private NameIdResponseDto supplier;
    private NameIdResponseDto warehouse;
    private BigDecimal subTotal;
    private BigDecimal discountAmount;
    private BigDecimal taxAmount;
    private BigDecimal grandTotal;
    private BigDecimal paidAmount;
    private BigDecimal dueAmount;
    private String status;
    private String notes;
    private List<PurchaseItemResponseDto> items;
}
