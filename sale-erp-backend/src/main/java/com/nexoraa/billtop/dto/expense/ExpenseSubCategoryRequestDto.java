package com.nexoraa.billtop.dto.expense;

import com.nexoraa.billtop.constants.ValidationMessage;
import com.nexoraa.billtop.enums.Status;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ExpenseSubCategoryRequestDto {

    @NotNull(message = "Expense category id is required")
    @Positive(message = ValidationMessage.ID_INVALID)
    private Long expenseCategoryId;

    @NotBlank(message = ValidationMessage.NAME_REQUIRED)
    @Size(min = 2, max = 100, message = ValidationMessage.NAME_INVALID)
    private String name;

    @Size(max = 500, message = ValidationMessage.DESCRIPTION_INVALID)
    private String description;

    private Status status;
}
