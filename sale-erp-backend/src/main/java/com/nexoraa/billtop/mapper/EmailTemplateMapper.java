package com.nexoraa.billtop.mapper;

import com.nexoraa.billtop.dto.email.EmailTemplateRequestDto;
import com.nexoraa.billtop.dto.email.EmailTemplateResponseDto;
import com.nexoraa.billtop.entity.EmailTemplate;
import org.mapstruct.Builder;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.MappingTarget;

@Mapper(componentModel = "spring", builder = @Builder(disableBuilder = true))
public interface EmailTemplateMapper {

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "organization", ignore = true)
    @Mapping(target = "status", expression = "java(request.getStatus() == null ? com.nexoraa.billtop.enums.Status.ACTIVE : request.getStatus())")
    EmailTemplate toEntity(EmailTemplateRequestDto request);

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "organization", ignore = true)
    @Mapping(target = "status", expression = "java(request.getStatus() == null ? template.getStatus() : request.getStatus())")
    void updateEntity(EmailTemplateRequestDto request, @MappingTarget EmailTemplate template);

    EmailTemplateResponseDto toResponse(EmailTemplate template);
}


