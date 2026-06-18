package com.nexoraa.billtop.mapper;

import com.nexoraa.billtop.dto.location.CountryResponseDto;
import com.nexoraa.billtop.dto.location.StateResponseDto;
import com.nexoraa.billtop.entity.Country;
import com.nexoraa.billtop.entity.State;
import org.mapstruct.Builder;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;

@Mapper(componentModel = "spring", builder = @Builder(disableBuilder = true))
public interface LocationMapper {

    CountryResponseDto toCountryResponse(Country country);

    @Mapping(target = "countryId", source = "country.id")
    @Mapping(target = "countryName", source = "country.name")
    StateResponseDto toStateResponse(State state);
}
