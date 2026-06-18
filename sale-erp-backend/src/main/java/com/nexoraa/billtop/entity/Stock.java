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

@Entity
@Table(name = "stock")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Stock extends BaseEntity {

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

    @Column(name = "available_qty", precision = 15, scale = 3)
    private BigDecimal availableQty;

    @Column(name = "reserved_qty", precision = 15, scale = 3)
    private BigDecimal reservedQty;

    @Column(name = "minimum_stock", precision = 15, scale = 3)
    private BigDecimal minimumStock;

    @Column(name = "reorder_level", precision = 15, scale = 3)
    private BigDecimal reorderLevel;

    @Column(name = "rack_location", length = 100)
    private String rackLocation;
}


