package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.whatsapp.WhatsAppSendDocumentRequestDto;
import com.nexoraa.billtop.service.WhatsAppService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Validated
@RestController
@RequestMapping("/api/v1/whatsapp")
public class WhatsAppController {

    private final WhatsAppService whatsAppService;

    public WhatsAppController(WhatsAppService whatsAppService) {
        this.whatsAppService = whatsAppService;
    }

    @PostMapping("/send-document")
    public ResponseEntity<ApiResponseDto<Void>> sendDocument(@Valid @RequestBody WhatsAppSendDocumentRequestDto request) {
        whatsAppService.sendDocument(request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.WHATSAPP_SENT));
    }

    @PostMapping("/sales/{saleId}/send-invoice")
    public ResponseEntity<ApiResponseDto<Void>> sendInvoice(
            @PathVariable @Positive Long saleId,
            @RequestParam @NotBlank String documentUrl
    ) {
        whatsAppService.sendInvoice(saleId, documentUrl);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.WHATSAPP_SENT));
    }
}
