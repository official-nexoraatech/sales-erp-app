package com.nexoraa.billtop.dto.unit;

import com.nexoraa.billtop.enums.Status;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class UnitResponseDto {

    private Long id;
    private String name;
    private String shortName;
    private Status status;
}

