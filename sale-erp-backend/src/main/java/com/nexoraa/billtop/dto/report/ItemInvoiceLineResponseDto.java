package com.nexoraa.billtop.dto.report;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * One item line from a purchase or sale invoice, for the item-level purchase/sale
 * reports - as opposed to {@link com.nexoraa.billtop.dto.purchase.PurchaseListResponseDto}
 * / {@link com.nexoraa.billtop.dto.sales.SalesListResponseDto}, which are invoice-header
 * summaries with no per-item breakdown.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ItemInvoiceLineResponseDto {

    private LocalDate date;
    private String invoiceNo;
    private String supplierName;
    private String customerName;
    private String warehouseName;
    private String itemName;
    private String brandName;
    private BigDecimal unitPrice;
    private BigDecimal quantity;
    private BigDecimal discountAmount;
    private BigDecimal taxAmount;
    private BigDecimal totalAmount;
}
