package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.email.ConnectEmailAccountRequestDto;
import com.nexoraa.billtop.dto.email.EmailAccountResponseDto;
import com.nexoraa.billtop.service.EmailAccountService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/email-accounts")
public class EmailAccountController {

    private final EmailAccountService emailAccountService;

    public EmailAccountController(EmailAccountService emailAccountService) {
        this.emailAccountService = emailAccountService;
    }

    @PostMapping("/me")
    public ResponseEntity<ApiResponseDto<EmailAccountResponseDto>> connect(
            @Valid @RequestBody ConnectEmailAccountRequestDto request
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.EMAIL_ACCOUNT_CONNECTED,
                emailAccountService.connect(request)
        ));
    }

    @GetMapping("/me")
    public ResponseEntity<ApiResponseDto<EmailAccountResponseDto>> getMyAccount() {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.EMAIL_ACCOUNT_RETRIEVED,
                emailAccountService.getMyAccount()
        ));
    }

    @DeleteMapping("/me")
    public ResponseEntity<ApiResponseDto<Void>> disconnect() {
        emailAccountService.disconnect();
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.EMAIL_ACCOUNT_DISCONNECTED));
    }
}
