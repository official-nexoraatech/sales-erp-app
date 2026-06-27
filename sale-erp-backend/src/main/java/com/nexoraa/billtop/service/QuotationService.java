package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.quotation.QuotationConvertRequestDto;
import com.nexoraa.billtop.dto.quotation.QuotationCreateResponseDto;
import com.nexoraa.billtop.dto.quotation.QuotationDetailResponseDto;
import com.nexoraa.billtop.dto.quotation.QuotationListResponseDto;
import com.nexoraa.billtop.dto.quotation.QuotationRequestDto;
import com.nexoraa.billtop.dto.sales.SalesCreateResponseDto;

import java.time.LocalDate;

public interface QuotationService {

    QuotationCreateResponseDto createQuotation(QuotationRequestDto request);

    PageResponseDto<QuotationListResponseDto> getQuotations(
            int page,
            int size,
            String search,
            Long customerId,
            String status,
            LocalDate fromDate,
            LocalDate toDate
    );

    QuotationDetailResponseDto getQuotationById(Long id);

    void updateQuotation(Long id, QuotationRequestDto request);

    void deleteQuotation(Long id);

    SalesCreateResponseDto convertToInvoice(Long id, QuotationConvertRequestDto request);
}
