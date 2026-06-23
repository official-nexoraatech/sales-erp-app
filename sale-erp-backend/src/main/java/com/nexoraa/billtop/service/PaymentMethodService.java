package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.common.IdResponseDto;
import com.nexoraa.billtop.dto.payment.PaymentMethodRequestDto;
import com.nexoraa.billtop.dto.payment.PaymentMethodResponseDto;

import java.util.List;

public interface PaymentMethodService {

    IdResponseDto createPaymentMethod(PaymentMethodRequestDto request);

    List<PaymentMethodResponseDto> getPaymentMethods(String search);

    PaymentMethodResponseDto getPaymentMethodById(Long id);

    void updatePaymentMethod(Long id, PaymentMethodRequestDto request);

    void deletePaymentMethod(Long id);
}
