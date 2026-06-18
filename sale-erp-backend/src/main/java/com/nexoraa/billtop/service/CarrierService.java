package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.carrier.CarrierRequestDto;
import com.nexoraa.billtop.dto.carrier.CarrierResponseDto;

public interface CarrierService {

    void createCarrier(CarrierRequestDto request);

    PageResponseDto<CarrierResponseDto> getCarriers(int page, int size, String search);

    CarrierResponseDto getCarrierById(Long id);

    void updateCarrier(Long id, CarrierRequestDto request);

    void deleteCarrier(Long id);
}
