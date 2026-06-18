package com.nexoraa.billtop.dto.bank;

import com.nexoraa.billtop.constants.ValidationMessage;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class BankAccountRequestDto {

    @NotBlank(message = ValidationMessage.NAME_REQUIRED)
    @Size(max = 150, message = ValidationMessage.NAME_INVALID)
    private String bankName;

    @NotBlank(message = ValidationMessage.NAME_REQUIRED)
    @Size(max = 150, message = ValidationMessage.NAME_INVALID)
    private String accountName;

    @Size(max = 50, message = ValidationMessage.DESCRIPTION_INVALID)
    private String accountNumber;

    @Size(max = 20, message = ValidationMessage.DESCRIPTION_INVALID)
    private String ifscCode;

    @Size(max = 150, message = ValidationMessage.NAME_INVALID)
    private String branchName;

    @DecimalMin(value = "0.0", message = ValidationMessage.PRICE_INVALID)
    private BigDecimal openingBalance;
}
