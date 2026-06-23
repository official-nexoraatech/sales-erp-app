package com.nexoraa.billtop.dto.permission;

import com.nexoraa.billtop.enums.Status;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PermissionResponseDto {

    private Long id;
    private String groupName;
    private String name;
    private String description;
    private String endpoint;
    private Status status;
}
