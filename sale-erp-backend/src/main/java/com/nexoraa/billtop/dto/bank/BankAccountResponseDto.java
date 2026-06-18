package com.nexoraa.billtop.dto.bank;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class BankAccountResponseDto {

    private Long bankAccountId;
    private String bankName;
    private String accountName;
    private String accountNumber;
    private String ifscCode;
    private String branchName;
    private BigDecimal openingBalance;
    private BigDecimal currentBalance;
}
