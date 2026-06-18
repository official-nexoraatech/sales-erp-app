package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.payment.PaymentDetailResponseDto;
import com.nexoraa.billtop.dto.payment.PaymentListResponseDto;
import com.nexoraa.billtop.dto.payment.PaymentOutCreateResponseDto;
import com.nexoraa.billtop.dto.payment.PaymentOutRequestDto;

public interface PaymentOutService {

    PaymentOutCreateResponseDto createPaymentOut(PaymentOutRequestDto request);

    PageResponseDto<PaymentListResponseDto> getPaymentOuts(int page, int size);

    PaymentDetailResponseDto getPaymentOutById(Long id);
}
