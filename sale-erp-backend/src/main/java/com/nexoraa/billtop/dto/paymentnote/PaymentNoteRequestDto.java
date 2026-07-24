package com.nexoraa.billtop.dto.paymentnote;

import com.nexoraa.billtop.constants.ValidationMessage;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PaymentNoteRequestDto {

    @NotNull(message = ValidationMessage.ID_REQUIRED)
    private Long contactId;

    private Long saleId;

    private Long paymentId;

    @NotNull(message = ValidationMessage.ID_REQUIRED)
    private String noteType;

    @NotNull(message = ValidationMessage.SUBJECT_REQUIRED)
    @Size(max = 200, message = ValidationMessage.SUBJECT_INVALID)
    private String subject;

    @Size(max = 2000, message = ValidationMessage.DESCRIPTION_INVALID)
    private String description;

    private BigDecimal amount;

    private String priority;

    private Long assignedToId;
}
