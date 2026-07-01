package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.pos.PosBillingRequestDto;
import com.nexoraa.billtop.dto.pos.PosBillingResponseDto;
import com.nexoraa.billtop.service.PosBillingService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Validated
@RestController
@RequestMapping("/api/v1/pos/billing")
public class PosBillingController {

    private final PosBillingService posBillingService;

    public PosBillingController(PosBillingService posBillingService) {
        this.posBillingService = posBillingService;
    }

    @PostMapping
    public ResponseEntity<ApiResponseDto<PosBillingResponseDto>> createBill(
            @Valid @RequestBody PosBillingRequestDto request
    ) {
        PosBillingResponseDto response = posBillingService.createBill(request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.POS_BILL_GENERATED, response));
    }
}
