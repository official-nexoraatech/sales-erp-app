package com.nexoraa.billtop.dto.expense;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ExpenseCreateResponseDto {

    private Long expenseId;
    private String expenseNo;
}
