package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.purchase.PurchaseReturnCreateResponseDto;
import com.nexoraa.billtop.dto.purchase.PurchaseReturnRequestDto;
import com.nexoraa.billtop.dto.returning.ReturnDetailResponseDto;
import com.nexoraa.billtop.dto.returning.ReturnListResponseDto;

public interface PurchaseReturnService {

    PurchaseReturnCreateResponseDto createPurchaseReturn(PurchaseReturnRequestDto request);

    PageResponseDto<ReturnListResponseDto> getPurchaseReturns(int page, int size);

    ReturnDetailResponseDto getPurchaseReturnById(Long id);
}
