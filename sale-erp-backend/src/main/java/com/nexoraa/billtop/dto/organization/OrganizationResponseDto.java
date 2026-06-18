package com.nexoraa.billtop.dto.organization;

import com.nexoraa.billtop.enums.Status;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class OrganizationResponseDto {

    private Long id;
    private String name;
    private String description;
    private String logoUrl;
    private OrganizationAddressResponseDto address;
    private Status status;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}

