package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.customer.CustomerCreateResponseDto;
import com.nexoraa.billtop.dto.customer.CustomerDetailResponseDto;
import com.nexoraa.billtop.dto.customer.CustomerListResponseDto;
import com.nexoraa.billtop.dto.customer.CustomerRequestDto;
import com.nexoraa.billtop.dto.ledger.LedgerResponseDto;
import com.nexoraa.billtop.entity.Branch;
import com.nexoraa.billtop.entity.Organization;

public interface CustomerService {

    CustomerCreateResponseDto createCustomer(CustomerRequestDto request);

    /**
     * Seeds the default "Walk-in Customer" contact for a newly created
     * organization, so POS billing always has a fallback customer available.
     */
    void createWalkInCustomerForOrganization(Organization organization, Branch branch);

    void updateCustomer(Long id, CustomerRequestDto request);

    CustomerDetailResponseDto getCustomerById(Long id);

    PageResponseDto<CustomerListResponseDto> getCustomers(int page, int size, String search);

    void deleteCustomer(Long id);

    LedgerResponseDto getCustomerLedger(Long id);
}
