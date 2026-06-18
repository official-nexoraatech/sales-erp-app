package com.nexoraa.billtop.dto.organization;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class OrganizationAddressResponseDto {

    private Long id;
    private String addressLine1;
    private String addressLine2;
    private String city;
    private Long stateId;
    private String stateName;
    private Long countryId;
    private String countryName;
    private String pincode;
}
