package com.nexoraa.billtop.dto.location;

import com.nexoraa.billtop.enums.Status;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CountryResponseDto {

    private Long id;
    private String name;
    private String isoCode;
    private String currencyCode;
    private Status status;
}
