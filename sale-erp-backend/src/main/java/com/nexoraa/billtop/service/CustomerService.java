package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.customer.CustomerCreateResponseDto;
import com.nexoraa.billtop.dto.customer.CustomerDetailResponseDto;
import com.nexoraa.billtop.dto.customer.CustomerListResponseDto;
import com.nexoraa.billtop.dto.customer.CustomerRequestDto;
import com.nexoraa.billtop.dto.ledger.LedgerResponseDto;

public interface CustomerService {

    CustomerCreateResponseDto createCustomer(CustomerRequestDto request);

    void updateCustomer(Long id, CustomerRequestDto request);

    CustomerDetailResponseDto getCustomerById(Long id);

    PageResponseDto<CustomerListResponseDto> getCustomers(int page, int size, String search);

    void deleteCustomer(Long id);

    LedgerResponseDto getCustomerLedger(Long id);
}
