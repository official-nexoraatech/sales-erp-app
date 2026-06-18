package com.nexoraa.billtop.dto.email;

import com.nexoraa.billtop.enums.Status;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class EmailTemplateResponseDto {

    private Long id;
    private String name;
    private String subject;
    private String content;
    private Status status;
}

