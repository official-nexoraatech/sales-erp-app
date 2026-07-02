package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.payment.PaymentDetailResponseDto;
import com.nexoraa.billtop.dto.payment.PaymentInCreateResponseDto;
import com.nexoraa.billtop.dto.payment.PaymentInRequestDto;
import com.nexoraa.billtop.dto.payment.PaymentListResponseDto;

public interface PaymentInService {

    PaymentInCreateResponseDto createPaymentIn(PaymentInRequestDto request);

    PageResponseDto<PaymentListResponseDto> getPaymentIns(int page, int size);

    PaymentDetailResponseDto getPaymentInById(Long id);

    PaymentInCreateResponseDto updatePaymentIn(Long id, PaymentInRequestDto request);

    void deletePaymentIn(Long id);
}
