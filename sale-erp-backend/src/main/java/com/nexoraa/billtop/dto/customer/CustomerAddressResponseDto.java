package com.nexoraa.billtop.dto.customer;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CustomerAddressResponseDto {

    private Long id;
    private String addressType;
    private String addressLine1;
    private String addressLine2;
    private String city;
    private Long stateId;
    private String stateName;
    private Long countryId;
    private String countryName;
    private String pincode;
}
