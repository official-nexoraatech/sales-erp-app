package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.common.IdResponseDto;
import com.nexoraa.billtop.dto.warehouse.WarehouseRequestDto;
import com.nexoraa.billtop.dto.warehouse.WarehouseResponseDto;
import com.nexoraa.billtop.entity.Organization;
import com.nexoraa.billtop.entity.Stock;
import com.nexoraa.billtop.entity.Warehouse;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.mapper.WarehouseMapper;
import com.nexoraa.billtop.repository.ItemPriceRepository;
import com.nexoraa.billtop.repository.ItemPriceSummaryProjection;
import com.nexoraa.billtop.repository.StockRepository;
import com.nexoraa.billtop.repository.WarehouseRepository;
import com.nexoraa.billtop.security.CurrentBranchService;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.WarehouseService;
import com.nexoraa.billtop.specification.MasterDataSpecification;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
public class WarehouseServiceImpl implements WarehouseService {

    private final WarehouseRepository warehouseRepository;
    private final StockRepository stockRepository;
    private final ItemPriceRepository itemPriceRepository;
    private final WarehouseMapper warehouseMapper;
    private final TransactionSupport support;
    private final CurrentOrganizationService currentOrganizationService;
    private final CurrentBranchService currentBranchService;

    public WarehouseServiceImpl(
            WarehouseRepository warehouseRepository,
            StockRepository stockRepository,
            ItemPriceRepository itemPriceRepository,
            WarehouseMapper warehouseMapper,
            TransactionSupport support,
            CurrentOrganizationService currentOrganizationService,
            CurrentBranchService currentBranchService
    ) {
        this.warehouseRepository = warehouseRepository;
        this.stockRepository = stockRepository;
        this.itemPriceRepository = itemPriceRepository;
        this.warehouseMapper = warehouseMapper;
        this.support = support;
        this.currentOrganizationService = currentOrganizationService;
        this.currentBranchService = currentBranchService;
    }

    @Override
    @Transactional
    public IdResponseDto createWarehouse(WarehouseRequestDto request) {
        Organization organization = currentOrganizationService.getOrganizationReference();
        Long organizationId = organization.getId();
        if (warehouseRepository.existsByWarehouseCodeIgnoreCaseAndOrganizationIdAndStatus(
                request.getWarehouseCode(),
                organizationId,
        com.nexoraa.billtop.enums.Status.ACTIVE)) {
            throw new BadRequestException(ErrorMessage.WAREHOUSE_ALREADY_EXISTS, "WAREHOUSE_ALREADY_EXISTS");
        }
        Warehouse warehouse = warehouseMapper.toEntity(request);
        warehouse.setOrganization(organization);
        warehouse.setBranch(currentBranchService.getBranchReference());
        return IdResponseDto.builder().id(warehouseRepository.save(warehouse).getId()).build();
    }

    @Override
    @Transactional(readOnly = true)
    public List<WarehouseResponseDto> getWarehouses(String search) {
        Specification<Warehouse> specification = MasterDataSpecification.<Warehouse>active()
                .and(MasterDataSpecification.organization(currentOrganizationService.getOrganizationId()))
                .and(MasterDataSpecification.branch(currentBranchService.getBranchId()))
                .and(MasterDataSpecification.search(search, "name", "warehouseCode", "address"));
        List<Warehouse> warehouses = warehouseRepository.findAll(specification, Sort.by(Sort.Direction.ASC, "name"));
        return toEnrichedResponses(warehouses);
    }

    @Override
    @Transactional(readOnly = true)
    public WarehouseResponseDto getWarehouseById(Long id) {
        return toEnrichedResponses(List.of(getActiveWarehouse(id))).get(0);
    }

    @Override
    @Transactional
    public void updateWarehouse(Long id, WarehouseRequestDto request) {
        Warehouse warehouse = getActiveWarehouse(id);
        Long organizationId = currentOrganizationService.getOrganizationId();
        if (warehouseRepository.existsByWarehouseCodeIgnoreCaseAndIdNotAndOrganizationIdAndStatus(
                request.getWarehouseCode(),
                id,
                organizationId,
        com.nexoraa.billtop.enums.Status.ACTIVE)) {
            throw new BadRequestException(ErrorMessage.WAREHOUSE_ALREADY_EXISTS, "WAREHOUSE_ALREADY_EXISTS");
        }
        warehouseMapper.updateEntity(request, warehouse);
        warehouseRepository.save(warehouse);
    }

    @Override
    @Transactional
    public void deleteWarehouse(Long id) {
        Warehouse warehouse = getActiveWarehouse(id);
        warehouse.setStatus(com.nexoraa.billtop.enums.Status.INACTIVE);
        warehouseRepository.save(warehouse);
    }

    private Warehouse getActiveWarehouse(Long id) {
        return warehouseRepository.findByIdAndOrganizationIdAndBranchIdAndStatus(
                        id,
                        currentOrganizationService.getOrganizationId(),
                        currentBranchService.getBranchId(),
                com.nexoraa.billtop.enums.Status.ACTIVE)
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.WAREHOUSE_NOT_FOUND, "WAREHOUSE_NOT_FOUND"));
    }

    private List<WarehouseResponseDto> toEnrichedResponses(List<Warehouse> warehouses) {
        List<WarehouseResponseDto> responses = new ArrayList<>();
        Map<Long, WarehouseResponseDto> responseByWarehouseId = new HashMap<>();
        for (Warehouse warehouse : warehouses) {
            WarehouseResponseDto response = warehouseMapper.toResponse(warehouse);
            responses.add(response);
            responseByWarehouseId.put(warehouse.getId(), response);
        }
        applyWarehouseSummaries(responseByWarehouseId);
        return responses;
    }

    private void applyWarehouseSummaries(Map<Long, WarehouseResponseDto> responseByWarehouseId) {
        if (responseByWarehouseId.isEmpty()) {
            return;
        }

        List<Stock> stocks = stockRepository.findByWarehouse_IdInAndItem_Organization_Id(
                responseByWarehouseId.keySet(),
                currentOrganizationService.getOrganizationId()
        );
        Map<Long, ItemPriceValues> priceByItemId = latestItemPrices(stocks);
        Map<Long, WarehouseTotals> totalsByWarehouseId = new HashMap<>();

        for (Stock stock : stocks) {
            if (stock.getWarehouse() == null || stock.getItem() == null) {
                continue;
            }
            Long warehouseId = stock.getWarehouse().getId();
            Long itemId = stock.getItem().getId();
            if (!responseByWarehouseId.containsKey(warehouseId)) {
                continue;
            }

            BigDecimal availableQty = support.defaultZero(stock.getAvailableQty());
            ItemPriceValues price = priceByItemId.getOrDefault(itemId, ItemPriceValues.ZERO);
            WarehouseTotals totals = totalsByWarehouseId.computeIfAbsent(warehouseId, id -> new WarehouseTotals());
            totals.itemIds.add(itemId);
            totals.availableStock = totals.availableStock.add(availableQty);
            totals.worthCost = totals.worthCost.add(availableQty.multiply(price.purchasePrice()));
            totals.worthSale = totals.worthSale.add(availableQty.multiply(price.salePrice()));
        }

        for (Map.Entry<Long, WarehouseResponseDto> entry : responseByWarehouseId.entrySet()) {
            WarehouseTotals totals = totalsByWarehouseId.getOrDefault(entry.getKey(), new WarehouseTotals());
            WarehouseResponseDto response = entry.getValue();
            BigDecimal worthCost = support.money(totals.worthCost);
            BigDecimal worthSale = support.money(totals.worthSale);
            response.setTotalItems((long) totals.itemIds.size());
            response.setAvailableStock(support.quantity(totals.availableStock));
            response.setWorthCost(worthCost);
            response.setWorthSale(worthSale);
            response.setWorthProfit(support.money(worthSale.subtract(worthCost)));
        }
    }

    private Map<Long, ItemPriceValues> latestItemPrices(List<Stock> stocks) {
        Set<Long> itemIds = new HashSet<>();
        for (Stock stock : stocks) {
            if (stock.getItem() != null) {
                itemIds.add(stock.getItem().getId());
            }
        }
        if (itemIds.isEmpty()) {
            return Map.of();
        }

        Map<Long, ItemPriceValues> priceByItemId = new HashMap<>();
        for (ItemPriceSummaryProjection price : itemPriceRepository.findLatestPricesByItemIds(itemIds)) {
            priceByItemId.put(
                    price.getItemId(),
                    new ItemPriceValues(
                            support.defaultZero(price.getPurchasePrice()),
                            support.defaultZero(price.getSalePrice())
                    )
            );
        }
        return priceByItemId;
    }

    private static class WarehouseTotals {
        private final Set<Long> itemIds = new HashSet<>();
        private BigDecimal availableStock = TransactionSupport.ZERO;
        private BigDecimal worthCost = TransactionSupport.ZERO;
        private BigDecimal worthSale = TransactionSupport.ZERO;
    }

    private record ItemPriceValues(BigDecimal purchasePrice, BigDecimal salePrice) {
        private static final ItemPriceValues ZERO = new ItemPriceValues(TransactionSupport.ZERO, TransactionSupport.ZERO);
    }
}





