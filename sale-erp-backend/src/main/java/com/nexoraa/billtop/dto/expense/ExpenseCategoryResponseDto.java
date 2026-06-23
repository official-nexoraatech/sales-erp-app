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
public class ExpenseCategoryResponseDto {

    private Long id;
    private Long organizationId;
    private String name;
    private String description;
    private Status status;
}
