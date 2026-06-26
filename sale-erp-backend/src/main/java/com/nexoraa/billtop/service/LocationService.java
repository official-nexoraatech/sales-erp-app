package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.location.CountryResponseDto;
import com.nexoraa.billtop.dto.location.StateResponseDto;

import java.util.List;

public interface LocationService {

    List<CountryResponseDto> getCountries();

    List<StateResponseDto> getStates();
}
