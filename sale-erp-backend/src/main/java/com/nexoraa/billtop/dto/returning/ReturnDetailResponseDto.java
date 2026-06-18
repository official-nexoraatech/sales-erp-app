package com.nexoraa.billtop.dto.returning;

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
public class ReturnDetailResponseDto {

    private Long returnId;
    private String returnNo;
    private LocalDate returnDate;
    private NameIdResponseDto party;
    private String reason;
    private BigDecimal subTotal;
    private BigDecimal discountAmount;
    private BigDecimal taxAmount;
    private BigDecimal grandTotal;
    private List<ReturnItemResponseDto> items;
}
