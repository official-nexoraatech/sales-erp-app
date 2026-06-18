package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.customer.CustomerDetailResponseDto;
import com.nexoraa.billtop.dto.customer.CustomerListResponseDto;
import com.nexoraa.billtop.dto.customer.CustomerRequestDto;
import com.nexoraa.billtop.dto.ledger.LedgerResponseDto;
import com.nexoraa.billtop.service.CustomerService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Positive;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Validated
@RestController
@RequestMapping("/api/v1/customers")
public class CustomerController {

    private final CustomerService customerService;

    public CustomerController(CustomerService customerService) {
        this.customerService = customerService;
    }

    @PostMapping
    public ResponseEntity<ApiResponseDto<Void>> createCustomer(
            @Valid @RequestBody CustomerRequestDto request
    ) {
        customerService.createCustomer(request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.CUSTOMER_CREATED));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> updateCustomer(
            @PathVariable @Positive Long id,
            @Valid @RequestBody CustomerRequestDto request
    ) {
        customerService.updateCustomer(id, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.CUSTOMER_UPDATED));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponseDto<CustomerDetailResponseDto>> getCustomerById(@PathVariable @Positive Long id) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.CUSTOMER_RETRIEVED,
                customerService.getCustomerById(id)
        ));
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<PageResponseDto<CustomerListResponseDto>>> getCustomers(
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Positive int size,
            @RequestParam(required = false) String search
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.CUSTOMERS_RETRIEVED,
                customerService.getCustomers(page, size, search)
        ));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> deleteCustomer(@PathVariable @Positive Long id) {
        customerService.deleteCustomer(id);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.CUSTOMER_DELETED));
    }

    @GetMapping("/{id}/ledger")
    public ResponseEntity<ApiResponseDto<LedgerResponseDto>> getCustomerLedger(@PathVariable @Positive Long id) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.CUSTOMER_LEDGER_RETRIEVED,
                customerService.getCustomerLedger(id)
        ));
    }
}
