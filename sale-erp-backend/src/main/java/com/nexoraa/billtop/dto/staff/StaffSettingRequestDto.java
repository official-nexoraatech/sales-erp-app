package com.nexoraa.billtop.dto.staff;

import com.nexoraa.billtop.enums.Status;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class StaffSettingRequestDto {

    @NotBlank(message = "Name is required")
    @Size(max = 150, message = "Name must be 150 characters or less")
    private String name;

    private String description;

    @NotNull(message = "Status is required")
    private Status status;
}
