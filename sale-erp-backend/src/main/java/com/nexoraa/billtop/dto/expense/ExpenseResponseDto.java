package com.nexoraa.billtop.dto.expense;

import com.nexoraa.billtop.dto.common.NameIdResponseDto;
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
public class ExpenseResponseDto {

    private Long expenseId;
    private String expenseNo;
    private NameIdResponseDto expenseCategory;
    private LocalDate expenseDate;
    private BigDecimal amount;
    private NameIdResponseDto paymentMethod;
    private String notes;
}
