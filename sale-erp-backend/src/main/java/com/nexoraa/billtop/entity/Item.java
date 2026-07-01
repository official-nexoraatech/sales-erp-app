package com.nexoraa.billtop.entity;

import com.nexoraa.billtop.enums.ItemStatus;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "items")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Item extends BaseEntity {

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "organization_id", nullable = false)
    private Organization organization;

    @Column(name = "item_name", nullable = false, length = 150)
    private String itemName;

    @Column(name = "item_code", length = 50)
    private String itemCode;

    @Column(length = 80)
    private String sku;

    @Column(name = "hsn_code", length = 30)
    private String hsnCode;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "category_id")
    private Category category;


    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "brand_id")
    private Brand brand;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "base_unit_id")
    private Unit baseUnit;

    @Column(length = 500)
    private String description;

    @Column(name = "image_url", length = 500)
    private String imageUrl;

    @Builder.Default
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private ItemStatus status = ItemStatus.OUT_OF_STOCK;
}



