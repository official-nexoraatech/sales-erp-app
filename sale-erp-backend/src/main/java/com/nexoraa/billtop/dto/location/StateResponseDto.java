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
public class StateResponseDto {

    private Long id;
    private Long countryId;
    private String countryName;
    private String stateName;
    private String stateCode;
    private String gstCode;
    private Status status;
}
