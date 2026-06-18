package com.nexoraa.billtop.dto.staff;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class EmployeeDocumentResponseDto {

    private Long id;
    private Long employeeId;
    private String documentType;
    private String fileName;
    private String objectKey;
    private String objectUrl;
    private String contentType;
    private Long size;
    private LocalDateTime createdAt;
}
