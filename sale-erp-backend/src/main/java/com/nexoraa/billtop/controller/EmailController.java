package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.email.EmailTemplateRequestDto;
import com.nexoraa.billtop.dto.email.EmailTemplateResponseDto;
import com.nexoraa.billtop.service.EmailService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import org.springframework.http.MediaType;
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
import org.springframework.web.multipart.MultipartFile;

@Validated
@RestController
@RequestMapping("/api/v1/email")
public class EmailController {

    private final EmailService emailService;

    public EmailController(EmailService emailService) {
        this.emailService = emailService;
    }

    @GetMapping("/templates")
    public ResponseEntity<ApiResponseDto<PageResponseDto<EmailTemplateResponseDto>>> getTemplates(
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Positive int size,
            @RequestParam(required = false) String search
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.EMAIL_TEMPLATES_RETRIEVED,
                emailService.getTemplates(page, size, search)
        ));
    }

    @GetMapping("/templates/{id}")
    public ResponseEntity<ApiResponseDto<EmailTemplateResponseDto>> getTemplateById(
            @PathVariable @Positive Long id
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.EMAIL_TEMPLATE_RETRIEVED,
                emailService.getTemplateById(id)
        ));
    }

    @PostMapping("/templates")
    public ResponseEntity<ApiResponseDto<Void>> createTemplate(
            @Valid @RequestBody EmailTemplateRequestDto request
    ) {
        emailService.createTemplate(request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.EMAIL_TEMPLATE_CREATED));
    }

    @PutMapping("/templates/{id}")
    public ResponseEntity<ApiResponseDto<Void>> updateTemplate(
            @PathVariable @Positive Long id,
            @Valid @RequestBody EmailTemplateRequestDto request
    ) {
        emailService.updateTemplate(id, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.EMAIL_TEMPLATE_UPDATED));
    }

    @DeleteMapping("/templates/{id}")
    public ResponseEntity<ApiResponseDto<Void>> deleteTemplate(@PathVariable @Positive Long id) {
        emailService.deleteTemplate(id);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.EMAIL_TEMPLATE_DELETED));
    }

    @PostMapping(value = "/send", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<ApiResponseDto<Void>> sendEmail(
            @RequestParam @NotBlank String emailIds,
            @RequestParam @NotBlank String subject,
            @RequestParam @NotBlank String message,
            @RequestParam(required = false) MultipartFile file
    ) {
        emailService.sendEmail(emailIds, subject, message, file);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.EMAIL_SENT));
    }
}
