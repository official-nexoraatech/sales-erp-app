package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.unit.UnitRequestDto;
import com.nexoraa.billtop.dto.unit.UnitResponseDto;
import com.nexoraa.billtop.service.UnitService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Positive;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@Validated
@RestController
@RequestMapping("/api/v1/units")
public class UnitController {

    private final UnitService unitService;

    public UnitController(UnitService unitService) {
        this.unitService = unitService;
    }

    @PostMapping
    public ResponseEntity<ApiResponseDto<Void>> createUnit(@Valid @RequestBody UnitRequestDto request) {
        unitService.createUnit(request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.UNIT_CREATED));
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<List<UnitResponseDto>>> getUnits(
            @RequestParam(required = false) String search
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.UNITS_RETRIEVED, unitService.getUnits(search)));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponseDto<UnitResponseDto>> getUnitById(@PathVariable @Positive Long id) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.UNIT_RETRIEVED,
                unitService.getUnitById(id)
        ));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> updateUnit(
            @PathVariable @Positive Long id,
            @Valid @RequestBody UnitRequestDto request
    ) {
        unitService.updateUnit(id, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.UNIT_UPDATED));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> deleteUnit(@PathVariable @Positive Long id) {
        unitService.deleteUnit(id);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.UNIT_DELETED));
    }
}
