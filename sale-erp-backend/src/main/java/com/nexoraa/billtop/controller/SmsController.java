package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.sms.SmsSendRequestDto;
import com.nexoraa.billtop.dto.sms.SmsTemplateRequestDto;
import com.nexoraa.billtop.dto.sms.SmsTemplateResponseDto;
import com.nexoraa.billtop.service.SmsService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
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

@Validated
@RestController
@RequestMapping("/api/v1/sms")
public class SmsController {

    private final SmsService smsService;

    public SmsController(SmsService smsService) {
        this.smsService = smsService;
    }

    @GetMapping("/templates")
    public ResponseEntity<ApiResponseDto<PageResponseDto<SmsTemplateResponseDto>>> getTemplates(
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Positive int size,
            @RequestParam(required = false) String search
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.SMS_TEMPLATES_RETRIEVED,
                smsService.getTemplates(page, size, search)
        ));
    }

    @GetMapping("/templates/{id}")
    public ResponseEntity<ApiResponseDto<SmsTemplateResponseDto>> getTemplateById(
            @PathVariable @Positive Long id
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.SMS_TEMPLATE_RETRIEVED,
                smsService.getTemplateById(id)
        ));
    }

    @PostMapping("/templates")
    public ResponseEntity<ApiResponseDto<Void>> createTemplate(
            @Valid @RequestBody SmsTemplateRequestDto request
    ) {
        smsService.createTemplate(request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.SMS_TEMPLATE_CREATED));
    }

    @PutMapping("/templates/{id}")
    public ResponseEntity<ApiResponseDto<Void>> updateTemplate(
            @PathVariable @Positive Long id,
            @Valid @RequestBody SmsTemplateRequestDto request
    ) {
        smsService.updateTemplate(id, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.SMS_TEMPLATE_UPDATED));
    }

    @DeleteMapping("/templates/{id}")
    public ResponseEntity<ApiResponseDto<Void>> deleteTemplate(@PathVariable @Positive Long id) {
        smsService.deleteTemplate(id);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.SMS_TEMPLATE_DELETED));
    }

    @PostMapping("/send")
    public ResponseEntity<ApiResponseDto<Void>> sendSms(@Valid @RequestBody SmsSendRequestDto request) {
        smsService.sendSms(request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.SMS_SENT));
    }
}
