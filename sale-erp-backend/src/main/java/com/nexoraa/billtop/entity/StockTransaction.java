package com.nexoraa.billtop.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDateTime;

@Entity
@Table(name = "stock_transactions")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class StockTransaction extends BaseEntity {

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "organization_id", nullable = false)
    private Organization organization;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "item_id")
    private Item item;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "warehouse_id")
    private Warehouse warehouse;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "batch_id")
    private ItemBatch batch;

    @Column(name = "transaction_type", length = 50)
    private String transactionType;

    @Column(name = "reference_id")
    private Long referenceId;

    @Column(name = "qty_in", precision = 15, scale = 3)
    private BigDecimal qtyIn;

    @Column(name = "qty_out", precision = 15, scale = 3)
    private BigDecimal qtyOut;

    @Column(name = "balance_qty", precision = 15, scale = 3)
    private BigDecimal balanceQty;

    @Column(name = "transaction_date")
    private LocalDateTime transactionDate;

    @Column(length = 500)
    private String remarks;
}


