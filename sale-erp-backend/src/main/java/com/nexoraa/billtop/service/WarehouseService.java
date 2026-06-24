package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.common.IdResponseDto;
import com.nexoraa.billtop.dto.warehouse.WarehouseRequestDto;
import com.nexoraa.billtop.dto.warehouse.WarehouseResponseDto;

import java.util.List;

public interface WarehouseService {

    IdResponseDto createWarehouse(WarehouseRequestDto request);

    List<WarehouseResponseDto> getWarehouses(String search);

    WarehouseResponseDto getWarehouseById(Long id);

    void updateWarehouse(Long id, WarehouseRequestDto request);

    void deleteWarehouse(Long id);
}
