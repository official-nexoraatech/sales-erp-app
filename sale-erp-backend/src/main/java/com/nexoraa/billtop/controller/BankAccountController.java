package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.bank.BankAccountRequestDto;
import com.nexoraa.billtop.dto.bank.BankAccountResponseDto;
import com.nexoraa.billtop.dto.bank.BankLedgerResponseDto;
import com.nexoraa.billtop.service.BankAccountService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Positive;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@Validated
@RestController
@RequestMapping("/api/v1/bank-accounts")
public class BankAccountController {

    private final BankAccountService bankAccountService;

    public BankAccountController(BankAccountService bankAccountService) {
        this.bankAccountService = bankAccountService;
    }

    @PostMapping
    public ResponseEntity<ApiResponseDto<Void>> createBankAccount(
            @Valid @RequestBody BankAccountRequestDto request
    ) {
        bankAccountService.createBankAccount(request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.BANK_ACCOUNT_CREATED));
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<List<BankAccountResponseDto>>> getBankAccounts() {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.BANK_ACCOUNTS_RETRIEVED,
                bankAccountService.getBankAccounts()
        ));
    }

    @GetMapping("/{id}/transactions")
    public ResponseEntity<ApiResponseDto<BankLedgerResponseDto>> getBankTransactions(@PathVariable @Positive Long id) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.BANK_TRANSACTIONS_RETRIEVED,
                bankAccountService.getBankTransactions(id)
        ));
    }
}
