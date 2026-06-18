package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.stock.StockAdjustmentCreateResponseDto;
import com.nexoraa.billtop.dto.stock.StockAdjustmentRequestDto;
import com.nexoraa.billtop.dto.stock.StockAdjustmentResponseDto;

public interface StockAdjustmentService {

    StockAdjustmentCreateResponseDto createAdjustment(StockAdjustmentRequestDto request);

    PageResponseDto<StockAdjustmentResponseDto> getAdjustments(int page, int size);

    StockAdjustmentResponseDto getAdjustmentById(Long id);
}
