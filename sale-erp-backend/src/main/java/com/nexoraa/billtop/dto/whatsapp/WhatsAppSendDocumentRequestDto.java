package com.nexoraa.billtop.dto.whatsapp;

import com.nexoraa.billtop.constants.ValidationMessage;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class WhatsAppSendDocumentRequestDto {

    @NotEmpty(message = ValidationMessage.MOBILE_NUMBERS_REQUIRED)
    private List<@NotBlank(message = ValidationMessage.MOBILE_REQUIRED) String> mobileNumbers;

    @NotBlank(message = ValidationMessage.DOCUMENT_URL_REQUIRED)
    private String documentUrl;

    private String fileName;

    @Builder.Default
    private Map<String, String> templateParams = Map.of();
}
