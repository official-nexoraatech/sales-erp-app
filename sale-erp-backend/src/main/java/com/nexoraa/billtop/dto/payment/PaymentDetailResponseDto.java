package com.nexoraa.billtop.dto.payment;

import com.nexoraa.billtop.dto.common.NameIdResponseDto;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PaymentDetailResponseDto {

    private Long paymentId;
    private String paymentNo;
    private String paymentType;
    private NameIdResponseDto party;
    private NameIdResponseDto paymentMethod;
    private LocalDate paymentDate;
    private String referenceNo;
    private BigDecimal amount;
    private String notes;
    private List<Long> saleIds;
    private List<Long> purchaseIds;
}
