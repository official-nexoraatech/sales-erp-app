package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.payment.PaymentDetailResponseDto;
import com.nexoraa.billtop.dto.payment.PaymentListResponseDto;
import com.nexoraa.billtop.dto.payment.PaymentOutCreateResponseDto;
import com.nexoraa.billtop.dto.payment.PaymentOutRequestDto;
import com.nexoraa.billtop.service.PaymentOutService;
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
@RequestMapping("/api/v1/payment-out")
public class PaymentOutController {

    private final PaymentOutService paymentOutService;

    public PaymentOutController(PaymentOutService paymentOutService) {
        this.paymentOutService = paymentOutService;
    }

    @PostMapping
    public ResponseEntity<ApiResponseDto<Void>> createPaymentOut(
            @Valid @RequestBody PaymentOutRequestDto request
    ) {
        paymentOutService.createPaymentOut(request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.PAYMENT_MADE));
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<PageResponseDto<PaymentListResponseDto>>> getPaymentOuts(
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Positive int size
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.PAYMENTS_RETRIEVED,
                paymentOutService.getPaymentOuts(page, size)
        ));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponseDto<PaymentDetailResponseDto>> getPaymentOutById(@PathVariable @Positive Long id) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.PAYMENT_RETRIEVED,
                paymentOutService.getPaymentOutById(id)
        ));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponseDto<PaymentOutCreateResponseDto>> updatePaymentOut(
            @PathVariable @Positive Long id,
            @Valid @RequestBody PaymentOutRequestDto request
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.PAYMENT_OUT_UPDATED,
                paymentOutService.updatePaymentOut(id, request)
        ));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> deletePaymentOut(@PathVariable @Positive Long id) {
        paymentOutService.deletePaymentOut(id);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.PAYMENT_OUT_DELETED));
    }
}
