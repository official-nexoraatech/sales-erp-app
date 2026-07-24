package com.nexoraa.billtop.dto.paymentnote;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PaymentNoteAuditResponseDto {

    private String action;
    private String fieldName;
    private String oldValue;
    private String newValue;
    private String performedBy;
    private LocalDateTime performedAt;
}
