package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.staff.StaffSettingRequestDto;
import com.nexoraa.billtop.dto.staff.StaffSettingResponseDto;
import com.nexoraa.billtop.service.StaffSettingService;
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
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@Validated
@RestController
@RequestMapping("/api/v1/staff/settings")
public class StaffSettingController {

    private final StaffSettingService settingService;

    public StaffSettingController(StaffSettingService settingService) {
        this.settingService = settingService;
    }

    @GetMapping("/{type}")
    public ResponseEntity<ApiResponseDto<List<StaffSettingResponseDto>>> getSettings(@PathVariable String type) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.STAFF_SETTINGS_RETRIEVED,
                settingService.getSettings(type)
        ));
    }

    @PostMapping("/{type}")
    public ResponseEntity<ApiResponseDto<Void>> createSetting(
            @PathVariable String type,
            @Valid @RequestBody StaffSettingRequestDto request
    ) {
        settingService.createSetting(type, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.STAFF_SETTING_CREATED));
    }

    @PutMapping("/{type}/{id}")
    public ResponseEntity<ApiResponseDto<Void>> updateSetting(
            @PathVariable String type,
            @PathVariable @Positive Long id,
            @Valid @RequestBody StaffSettingRequestDto request
    ) {
        settingService.updateSetting(type, id, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.STAFF_SETTING_UPDATED));
    }

    @DeleteMapping("/{type}/{id}")
    public ResponseEntity<ApiResponseDto<Void>> deleteSetting(
            @PathVariable String type,
            @PathVariable @Positive Long id
    ) {
        settingService.deleteSetting(type, id);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.STAFF_SETTING_DELETED));
    }
}
