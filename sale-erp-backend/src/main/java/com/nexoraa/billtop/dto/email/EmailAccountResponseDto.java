package com.nexoraa.billtop.dto.email;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class EmailAccountResponseDto {

    private Long id;
    private String fromAddress;
    private String smtpHost;
    private Integer smtpPort;
    private String smtpUsername;
    private boolean useStarttls;
    private boolean useSsl;
    private boolean verified;
}
