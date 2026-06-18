package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.staff.StaffSettingRequestDto;
import com.nexoraa.billtop.dto.staff.StaffSettingResponseDto;

import java.util.List;

public interface StaffSettingService {

    List<StaffSettingResponseDto> getSettings(String type);

    void createSetting(String type, StaffSettingRequestDto request);

    void updateSetting(String type, Long id, StaffSettingRequestDto request);

    void deleteSetting(String type, Long id);
}
