package com.nexoraa.billtop.repository;

import java.math.BigDecimal;

public interface ItemPriceSummaryProjection {

    Long getItemId();

    BigDecimal getPurchasePrice();

    BigDecimal getSalePrice();
}
