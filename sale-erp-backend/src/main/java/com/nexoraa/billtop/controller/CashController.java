package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.cash.CashSummaryResponseDto;
import com.nexoraa.billtop.dto.cash.CashTransactionResponseDto;
import com.nexoraa.billtop.service.CashService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1/cash")
public class CashController {

    private final CashService cashService;

    public CashController(CashService cashService) {
        this.cashService = cashService;
    }

    @GetMapping("/summary")
    public ResponseEntity<ApiResponseDto<CashSummaryResponseDto>> getSummary() {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.CASH_SUMMARY_RETRIEVED,
                cashService.getSummary()
        ));
    }

    @GetMapping("/transactions")
    public ResponseEntity<ApiResponseDto<List<CashTransactionResponseDto>>> getTransactions() {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.CASH_TRANSACTIONS_RETRIEVED,
                cashService.getTransactions()
        ));
    }
}
