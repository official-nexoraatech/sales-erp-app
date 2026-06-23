package com.nexoraa.billtop.dto.expense;

import com.nexoraa.billtop.enums.Status;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ExpenseSubCategoryResponseDto {

    private Long id;
    private Long expenseCategoryId;
    private String expenseCategoryName;
    private String name;
    private String description;
    private Status status;
}
