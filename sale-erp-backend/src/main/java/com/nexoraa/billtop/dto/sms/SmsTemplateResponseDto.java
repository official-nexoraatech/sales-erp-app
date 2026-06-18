package com.nexoraa.billtop.dto.sms;

import com.nexoraa.billtop.enums.Status;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SmsTemplateResponseDto {

    private Long id;
    private String name;
    private String content;
    private Status status;
}

