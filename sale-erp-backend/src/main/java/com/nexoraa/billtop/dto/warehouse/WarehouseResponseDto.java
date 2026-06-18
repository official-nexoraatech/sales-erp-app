package com.nexoraa.billtop.dto.warehouse;

import com.nexoraa.billtop.enums.Status;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class WarehouseResponseDto {

    private Long id;
    private String name;
    private String warehouseCode;
    private String description;
    private String address;
    private Status status;
}

