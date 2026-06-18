package com.nexoraa.billtop.dto.payment;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PaymentInCreateResponseDto {

    private Long paymentId;
    private String paymentNo;
    private BigDecimal amount;
    private BigDecimal customerBalance;
}
