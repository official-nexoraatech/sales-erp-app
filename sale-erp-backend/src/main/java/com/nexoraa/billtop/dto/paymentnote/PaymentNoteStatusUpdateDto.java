package com.nexoraa.billtop.dto.paymentnote;

import com.nexoraa.billtop.constants.ValidationMessage;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PaymentNoteStatusUpdateDto {

    @NotNull(message = ValidationMessage.ID_REQUIRED)
    private String status;

    @Size(max = 2000, message = ValidationMessage.DESCRIPTION_INVALID)
    private String resolutionNotes;
}
