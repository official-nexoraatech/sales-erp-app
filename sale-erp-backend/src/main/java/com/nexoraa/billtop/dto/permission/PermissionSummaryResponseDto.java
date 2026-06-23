package com.nexoraa.billtop.dto.permission;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PermissionSummaryResponseDto {

    private Long id;
    private String name;
    private String description;
}
