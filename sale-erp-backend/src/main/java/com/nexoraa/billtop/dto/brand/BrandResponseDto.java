package com.nexoraa.billtop.dto.brand;

import com.nexoraa.billtop.enums.Status;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class BrandResponseDto {

    private Long id;
    private Long categoryId;
    private String categoryName;
    private String name;
    private String description;
    private Status status;
}

