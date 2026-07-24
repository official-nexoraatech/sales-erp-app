package com.nexoraa.billtop.dto.paymentnote;

import com.nexoraa.billtop.dto.common.NameIdResponseDto;
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
public class PaymentNoteDetailResponseDto {

    private Long paymentNoteId;
    private String noteNo;
    private NameIdResponseDto contact;
    private NameIdResponseDto sale;
    private NameIdResponseDto payment;
    private String noteType;
    private String subject;
    private String description;
    private BigDecimal amount;
    private String priority;
    private String status;
    private NameIdResponseDto assignedTo;
    private String resolutionNotes;
    private LocalDateTime resolvedAt;
    private LocalDateTime createdAt;
    private String createdBy;
}
