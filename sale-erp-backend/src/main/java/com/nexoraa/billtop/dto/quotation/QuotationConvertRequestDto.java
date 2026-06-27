package com.nexoraa.billtop.dto.quotation;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class QuotationConvertRequestDto {

    private LocalDate invoiceDate;
}
