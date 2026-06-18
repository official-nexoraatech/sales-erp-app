package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.sales.SalesCreateResponseDto;
import com.nexoraa.billtop.dto.sales.SalesDetailResponseDto;
import com.nexoraa.billtop.dto.sales.SalesInvoiceResponseDto;
import com.nexoraa.billtop.dto.sales.SalesListResponseDto;
import com.nexoraa.billtop.dto.sales.SalesRequestDto;

import java.time.LocalDate;

public interface SalesService {

    SalesCreateResponseDto createSale(SalesRequestDto request);

    PageResponseDto<SalesListResponseDto> getSales(
            int page,
            int size,
            String search,
            LocalDate fromDate,
            LocalDate toDate
    );

    SalesDetailResponseDto getSaleById(Long id);

    void updateSale(Long id, SalesRequestDto request);

    void cancelSale(Long id);

    SalesInvoiceResponseDto getInvoice(Long id);
}
