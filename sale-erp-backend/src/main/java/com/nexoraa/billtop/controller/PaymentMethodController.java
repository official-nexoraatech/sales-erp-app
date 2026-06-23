package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.common.IdResponseDto;
import com.nexoraa.billtop.dto.payment.PaymentMethodRequestDto;
import com.nexoraa.billtop.dto.payment.PaymentMethodResponseDto;
import com.nexoraa.billtop.service.PaymentMethodService;
import jakarta.validation.Valid;
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

import java.util.List;

@Validated
@RestController
@RequestMapping("/api/v1/payment-methods")
public class PaymentMethodController {

    private final PaymentMethodService paymentMethodService;

    public PaymentMethodController(PaymentMethodService paymentMethodService) {
        this.paymentMethodService = paymentMethodService;
    }

    @PostMapping
    public ResponseEntity<ApiResponseDto<IdResponseDto>> createPaymentMethod(
            @Valid @RequestBody PaymentMethodRequestDto request
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.PAYMENT_METHOD_CREATED,
                paymentMethodService.createPaymentMethod(request)
        ));
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<List<PaymentMethodResponseDto>>> getPaymentMethods(
            @RequestParam(required = false) String search
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.PAYMENT_METHODS_RETRIEVED,
                paymentMethodService.getPaymentMethods(search)
        ));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponseDto<PaymentMethodResponseDto>> getPaymentMethodById(
            @PathVariable @Positive Long id
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.PAYMENT_METHOD_RETRIEVED,
                paymentMethodService.getPaymentMethodById(id)
        ));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> updatePaymentMethod(
            @PathVariable @Positive Long id,
            @Valid @RequestBody PaymentMethodRequestDto request
    ) {
        paymentMethodService.updatePaymentMethod(id, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.PAYMENT_METHOD_UPDATED));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> deletePaymentMethod(@PathVariable @Positive Long id) {
        paymentMethodService.deletePaymentMethod(id);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.PAYMENT_METHOD_DELETED));
    }
}
