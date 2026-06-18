package com.nexoraa.billtop.mapper;

import com.nexoraa.billtop.dto.sms.SmsTemplateRequestDto;
import com.nexoraa.billtop.dto.sms.SmsTemplateResponseDto;
import com.nexoraa.billtop.entity.SmsTemplate;
import org.mapstruct.Builder;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.MappingTarget;

@Mapper(componentModel = "spring", builder = @Builder(disableBuilder = true))
public interface SmsTemplateMapper {

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "status", expression = "java(request.getStatus() == null ? com.nexoraa.billtop.enums.Status.ACTIVE : request.getStatus())")
    SmsTemplate toEntity(SmsTemplateRequestDto request);

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "status", expression = "java(request.getStatus() == null ? template.getStatus() : request.getStatus())")
    void updateEntity(SmsTemplateRequestDto request, @MappingTarget SmsTemplate template);

    SmsTemplateResponseDto toResponse(SmsTemplate template);
}


