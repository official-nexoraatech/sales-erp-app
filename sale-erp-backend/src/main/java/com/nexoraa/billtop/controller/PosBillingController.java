package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.pos.PosBillingRequestDto;
import com.nexoraa.billtop.dto.pos.PosBillingResponseDto;
import com.nexoraa.billtop.service.PosBillingService;
import com.nexoraa.billtop.service.PosInvoicePdfService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Positive;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Validated
@RestController
@RequestMapping("/api/v1/pos/billing")
public class PosBillingController {

    private final PosBillingService posBillingService;
    private final PosInvoicePdfService posInvoicePdfService;

    public PosBillingController(PosBillingService posBillingService, PosInvoicePdfService posInvoicePdfService) {
        this.posBillingService = posBillingService;
        this.posInvoicePdfService = posInvoicePdfService;
    }

    @PostMapping
    public ResponseEntity<ApiResponseDto<PosBillingResponseDto>> createBill(
            @Valid @RequestBody PosBillingRequestDto request
    ) {
        PosBillingResponseDto response = posBillingService.createBill(request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.POS_BILL_GENERATED, response));
    }

    @GetMapping("/{saleId}/invoice-pdf")
    public ResponseEntity<byte[]> downloadInvoicePdf(@PathVariable @Positive Long saleId) {
        PosInvoicePdfService.InvoicePdf invoice = posInvoicePdfService.generateInvoicePdf(saleId);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + invoice.fileName() + "\"")
                .contentType(MediaType.APPLICATION_PDF)
                .body(invoice.content());
    }
}
