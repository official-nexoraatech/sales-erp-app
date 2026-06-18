package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.returning.ReturnDetailResponseDto;
import com.nexoraa.billtop.dto.returning.ReturnListResponseDto;
import com.nexoraa.billtop.dto.sales.SalesReturnCreateResponseDto;
import com.nexoraa.billtop.dto.sales.SalesReturnRequestDto;

public interface SalesReturnService {

    SalesReturnCreateResponseDto createSalesReturn(SalesReturnRequestDto request);

    PageResponseDto<ReturnListResponseDto> getSalesReturns(int page, int size);

    ReturnDetailResponseDto getSalesReturnById(Long id);
}
