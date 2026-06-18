package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.payment.PaymentDetailResponseDto;
import com.nexoraa.billtop.dto.payment.PaymentInRequestDto;
import com.nexoraa.billtop.dto.payment.PaymentListResponseDto;
import com.nexoraa.billtop.service.PaymentInService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Positive;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Validated
@RestController
@RequestMapping("/api/v1/payment-in")
public class PaymentInController {

    private final PaymentInService paymentInService;

    public PaymentInController(PaymentInService paymentInService) {
        this.paymentInService = paymentInService;
    }

    @PostMapping
    public ResponseEntity<ApiResponseDto<Void>> createPaymentIn(
            @Valid @RequestBody PaymentInRequestDto request
    ) {
        paymentInService.createPaymentIn(request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.PAYMENT_RECEIVED));
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<PageResponseDto<PaymentListResponseDto>>> getPaymentIns(
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Positive int size
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.PAYMENTS_RETRIEVED,
                paymentInService.getPaymentIns(page, size)
        ));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponseDto<PaymentDetailResponseDto>> getPaymentInById(@PathVariable @Positive Long id) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.PAYMENT_RETRIEVED,
                paymentInService.getPaymentInById(id)
        ));
    }
}
