package com.nexoraa.billtop.dto.expense;

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
public class ExpenseListResponseDto {

    private Long expenseId;
    private String expenseNo;
    private String expenseCategoryName;
    private String expenseSubCategoryName;
    private LocalDate expenseDate;
    private BigDecimal amount;
    private String paymentMethod;
    private String notes;
}
