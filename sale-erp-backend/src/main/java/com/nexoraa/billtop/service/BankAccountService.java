package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.bank.BankAccountCreateResponseDto;
import com.nexoraa.billtop.dto.bank.BankAccountRequestDto;
import com.nexoraa.billtop.dto.bank.BankAccountResponseDto;
import com.nexoraa.billtop.dto.bank.BankLedgerResponseDto;

import java.util.List;

public interface BankAccountService {

    BankAccountCreateResponseDto createBankAccount(BankAccountRequestDto request);

    List<BankAccountResponseDto> getBankAccounts();

    BankLedgerResponseDto getBankTransactions(Long bankAccountId);
}
