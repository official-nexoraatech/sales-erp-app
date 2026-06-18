package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.pos.PosBillingRequestDto;
import com.nexoraa.billtop.dto.pos.PosBillingResponseDto;

public interface PosBillingService {

    PosBillingResponseDto createBill(PosBillingRequestDto request);
}
