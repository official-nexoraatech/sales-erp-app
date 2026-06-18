package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.ledger.LedgerResponseDto;
import com.nexoraa.billtop.dto.supplier.SupplierCreateResponseDto;
import com.nexoraa.billtop.dto.supplier.SupplierDetailResponseDto;
import com.nexoraa.billtop.dto.supplier.SupplierListResponseDto;
import com.nexoraa.billtop.dto.supplier.SupplierRequestDto;

public interface SupplierService {

    SupplierCreateResponseDto createSupplier(SupplierRequestDto request);

    void updateSupplier(Long id, SupplierRequestDto request);

    SupplierDetailResponseDto getSupplierById(Long id);

    PageResponseDto<SupplierListResponseDto> getSuppliers(int page, int size, String search);

    void deleteSupplier(Long id);

    LedgerResponseDto getSupplierLedger(Long id);
}
