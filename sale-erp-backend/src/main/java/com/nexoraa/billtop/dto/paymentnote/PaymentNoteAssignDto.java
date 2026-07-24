package com.nexoraa.billtop.dto.paymentnote;

import com.nexoraa.billtop.constants.ValidationMessage;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PaymentNoteAssignDto {

    @NotNull(message = ValidationMessage.ID_REQUIRED)
    private Long assignedToId;
}
