package com.nexoraa.billtop.dto.email;

import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.constants.ValidationMessage;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class EmailTemplateRequestDto {

    @NotBlank(message = ValidationMessage.NAME_REQUIRED)
    @Size(min = 2, max = 100, message = ValidationMessage.NAME_INVALID)
    private String name;

    @NotBlank(message = ValidationMessage.SUBJECT_REQUIRED)
    @Size(max = 200, message = ValidationMessage.SUBJECT_INVALID)
    private String subject;

    @NotBlank(message = ValidationMessage.CONTENT_REQUIRED)
    private String content;

    private Status status;
}

