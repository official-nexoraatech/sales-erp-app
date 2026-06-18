package com.nexoraa.billtop.dto.returning;

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
public class ReturnListResponseDto {

    private Long returnId;
    private String returnNo;
    private String partyName;
    private LocalDate returnDate;
    private BigDecimal grandTotal;
}
