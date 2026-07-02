package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.purchase.PurchaseCreateResponseDto;
import com.nexoraa.billtop.dto.purchase.PurchaseDetailResponseDto;
import com.nexoraa.billtop.dto.purchase.PurchaseListResponseDto;
import com.nexoraa.billtop.dto.purchase.PurchaseRequestDto;

import java.time.LocalDate;

public interface PurchaseService {

    PurchaseCreateResponseDto createPurchase(PurchaseRequestDto request);

    PageResponseDto<PurchaseListResponseDto> getPurchases(
            int page,
            int size,
            String search,
            LocalDate fromDate,
            LocalDate toDate
    );

    PurchaseDetailResponseDto getPurchaseById(Long id);

    void updatePurchase(Long id, PurchaseRequestDto request);

    void cancelPurchase(Long id);

    void deletePurchase(Long id);
}
