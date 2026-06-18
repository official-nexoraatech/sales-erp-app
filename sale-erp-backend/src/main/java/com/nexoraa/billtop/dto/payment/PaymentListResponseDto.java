package com.nexoraa.billtop.dto.payment;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PaymentListResponseDto {

    private Long paymentId;
    private String paymentNo;
    private String partyName;
    private String customerName;
    private String supplierName;
    private BigDecimal amount;
    private LocalDate paymentDate;
}
