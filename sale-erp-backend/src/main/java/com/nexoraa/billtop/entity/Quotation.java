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
import java.time.LocalDate;

@Entity
@Table(name = "quotations")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Quotation extends BaseEntity {

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "organization_id", nullable = false)
    private Organization organization;

    @Column(name = "quotation_no", nullable = false, length = 50)
    private String quotationNo;

    @Column(name = "quotation_date")
    private LocalDate quotationDate;

    @Column(name = "valid_until")
    private LocalDate validUntil;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "customer_id")
    private Contact customer;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "warehouse_id")
    private Warehouse warehouse;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "state_id")
    private State state;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "sales_person_id")
    private User salesPerson;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "converted_sale_id")
    private Sale convertedSale;

    @Column(name = "sub_total", precision = 15, scale = 2)
    private BigDecimal subTotal;

    @Column(name = "discount_amount", precision = 15, scale = 2)
    private BigDecimal discountAmount;

    @Column(name = "tax_amount", precision = 15, scale = 2)
    private BigDecimal taxAmount;

    @Column(name = "round_off", precision = 15, scale = 2)
    private BigDecimal roundOff;

    @Column(name = "grand_total", precision = 15, scale = 2)
    private BigDecimal grandTotal;

    @Column(length = 50)
    private String status;

    @Column(length = 500)
    private String notes;
}
