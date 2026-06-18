package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.email.EmailTemplateRequestDto;
import com.nexoraa.billtop.dto.email.EmailTemplateResponseDto;
import org.springframework.web.multipart.MultipartFile;

public interface EmailService {

    void createTemplate(EmailTemplateRequestDto request);

    PageResponseDto<EmailTemplateResponseDto> getTemplates(int page, int size, String search);

    EmailTemplateResponseDto getTemplateById(Long id);

    void updateTemplate(Long id, EmailTemplateRequestDto request);

    void deleteTemplate(Long id);

    void sendEmail(String emailIds, String subject, String message, MultipartFile file);
}
