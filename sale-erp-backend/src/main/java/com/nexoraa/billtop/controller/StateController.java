package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.location.StateResponseDto;
import com.nexoraa.billtop.service.LocationService;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@Validated
@RestController
@RequestMapping("/api/v1/states")
public class StateController {

    private final LocationService locationService;

    public StateController(LocationService locationService) {
        this.locationService = locationService;
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<List<StateResponseDto>>> getStates() {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.STATES_RETRIEVED,
                locationService.getStates()
        ));
    }
}
