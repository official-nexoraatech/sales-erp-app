package com.nexoraa.billtop.dto.permission;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AssignUserPermissionsRequestDto {

    @NotNull(message = "User id is required")
    @Positive(message = "User id must be positive")
    private Long userId;

    @NotEmpty(message = "Permission ids are required")
    private List<@NotNull(message = "Permission id is required") @Positive(message = "Permission id must be positive") Long> permissionIds;
}
