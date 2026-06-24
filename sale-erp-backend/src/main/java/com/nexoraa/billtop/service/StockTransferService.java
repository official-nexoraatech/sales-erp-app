package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.stock.StockTransferCreateResponseDto;
import com.nexoraa.billtop.dto.stock.StockTransferRequestDto;
import com.nexoraa.billtop.dto.stock.StockTransferResponseDto;

public interface StockTransferService {

    StockTransferCreateResponseDto transferStock(StockTransferRequestDto request);

    void updateTransfer(Long id, StockTransferRequestDto request);

    void deleteTransfer(Long id);

    PageResponseDto<StockTransferResponseDto> getTransfers(int page, int size);

    StockTransferResponseDto getTransferById(Long id);
}
