package com.nexoraa.billtop.dto.common;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class FileUploadResponseDto {

    private String fileName;
    private String objectKey;
    private String objectUrl;
    private String contentType;
    private Long size;
}
