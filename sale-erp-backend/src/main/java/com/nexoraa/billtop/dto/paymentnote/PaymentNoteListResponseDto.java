package com.nexoraa.billtop.dto.paymentnote;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PaymentNoteListResponseDto {

    private Long paymentNoteId;
    private String noteNo;
    private String subject;
    private String contactName;
    private String noteType;
    private String priority;
    private String status;
    private BigDecimal amount;
    private String assignedToName;
    private LocalDateTime createdAt;
}
