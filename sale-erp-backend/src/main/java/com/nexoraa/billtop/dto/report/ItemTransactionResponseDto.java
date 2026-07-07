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
public class ItemTransactionResponseDto {

    private LocalDate date;
    private String type;
    private String referenceNo;
    private String partyName;
    private String warehouseName;
    private String itemName;
    private String brandName;
    private String batchNo;
    private BigDecimal quantity;
    private BigDecimal stock;
}
