package com.nexoraa.billtop.dto.carrier;

import com.nexoraa.billtop.enums.Status;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CarrierResponseDto {

    private Long id;
    private String name;
    private String email;
    private String mobile;
    private String whatsappNo;
    private String address;
    private String note;
    private Status status;
}
