package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.sms.SmsSendRequestDto;
import com.nexoraa.billtop.dto.sms.SmsTemplateRequestDto;
import com.nexoraa.billtop.dto.sms.SmsTemplateResponseDto;

public interface SmsService {

    void createTemplate(SmsTemplateRequestDto request);

    PageResponseDto<SmsTemplateResponseDto> getTemplates(int page, int size, String search);

    SmsTemplateResponseDto getTemplateById(Long id);

    void updateTemplate(Long id, SmsTemplateRequestDto request);

    void deleteTemplate(Long id);

    void sendSms(SmsSendRequestDto request);
}
