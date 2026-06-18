package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.location.CountryResponseDto;
import com.nexoraa.billtop.dto.location.StateResponseDto;
import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.mapper.LocationMapper;
import com.nexoraa.billtop.repository.CountryRepository;
import com.nexoraa.billtop.repository.StateRepository;
import com.nexoraa.billtop.service.LocationService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class LocationServiceImpl implements LocationService {

    private final CountryRepository countryRepository;
    private final StateRepository stateRepository;
    private final LocationMapper locationMapper;

    public LocationServiceImpl(
            CountryRepository countryRepository,
            StateRepository stateRepository,
            LocationMapper locationMapper
    ) {
        this.countryRepository = countryRepository;
        this.stateRepository = stateRepository;
        this.locationMapper = locationMapper;
    }

    @Override
    @Transactional(readOnly = true)
    public List<CountryResponseDto> getCountries() {
        return countryRepository.findAllByStatusAndIsDeletedFalseOrderByNameAsc(Status.ACTIVE)
                .stream()
                .map(locationMapper::toCountryResponse)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<StateResponseDto> getStatesByCountryId(Long countryId) {
        if (!countryRepository.existsByIdAndStatusAndIsDeletedFalse(countryId, Status.ACTIVE)) {
            throw new ResourceNotFoundException(ErrorMessage.COUNTRY_NOT_FOUND, "COUNTRY_NOT_FOUND");
        }
        return stateRepository.findAllByCountry_IdAndStatusAndIsDeletedFalseOrderByStateNameAsc(countryId, Status.ACTIVE)
                .stream()
                .map(locationMapper::toStateResponse)
                .toList();
    }
}
