package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.common.IdResponseDto;
import com.nexoraa.billtop.dto.unit.UnitRequestDto;
import com.nexoraa.billtop.dto.unit.UnitResponseDto;

import java.util.List;

public interface UnitService {

    IdResponseDto createUnit(UnitRequestDto request);

    List<UnitResponseDto> getUnits(String search);

    UnitResponseDto getUnitById(Long id);

    void updateUnit(Long id, UnitRequestDto request);

    void deleteUnit(Long id);
}
