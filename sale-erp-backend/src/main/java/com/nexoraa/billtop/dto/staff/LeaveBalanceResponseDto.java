package com.nexoraa.billtop.dto.staff;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class LeaveBalanceResponseDto {

    private String leaveType;
    private BigDecimal allotted;
    private BigDecimal used;
    private BigDecimal remaining;
}
