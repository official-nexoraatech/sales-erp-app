package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.stock.StockAdjustmentCreateResponseDto;
import com.nexoraa.billtop.dto.stock.StockAdjustmentItemRequestDto;
import com.nexoraa.billtop.dto.stock.StockAdjustmentItemResponseDto;
import com.nexoraa.billtop.dto.stock.StockAdjustmentRequestDto;
import com.nexoraa.billtop.dto.stock.StockAdjustmentResponseDto;
import com.nexoraa.billtop.entity.Item;
import com.nexoraa.billtop.entity.Organization;
import com.nexoraa.billtop.entity.StockAdjustment;
import com.nexoraa.billtop.entity.StockAdjustmentItem;
import com.nexoraa.billtop.entity.Warehouse;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.repository.StockAdjustmentItemRepository;
import com.nexoraa.billtop.repository.StockAdjustmentRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.StockAdjustmentService;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.List;

@Service
public class StockAdjustmentServiceImpl implements StockAdjustmentService {

    private static final String PREFIX = "ADJ-";
    private static final String TX_ADJUSTMENT_IN = "STOCK_ADJUSTMENT_IN";
    private static final String TX_ADJUSTMENT_OUT = "STOCK_ADJUSTMENT_OUT";
    private static final String TX_ADJUSTMENT_REVERSE_IN = "STOCK_ADJUSTMENT_REVERSE_IN";
    private static final String TX_ADJUSTMENT_REVERSE_OUT = "STOCK_ADJUSTMENT_REVERSE_OUT";

    private final StockAdjustmentRepository stockAdjustmentRepository;
    private final StockAdjustmentItemRepository stockAdjustmentItemRepository;
    private final TransactionSupport support;
    private final CurrentOrganizationService currentOrganizationService;

    public StockAdjustmentServiceImpl(
            StockAdjustmentRepository stockAdjustmentRepository,
            StockAdjustmentItemRepository stockAdjustmentItemRepository,
            TransactionSupport support,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.stockAdjustmentRepository = stockAdjustmentRepository;
        this.stockAdjustmentItemRepository = stockAdjustmentItemRepository;
        this.support = support;
        this.currentOrganizationService = currentOrganizationService;
    }

    @Override
    @Transactional
    public StockAdjustmentCreateResponseDto createAdjustment(StockAdjustmentRequestDto request) {
        Organization organization = currentOrganizationService.getOrganizationReference();
        Warehouse warehouse = support.getActiveWarehouse(request.getWarehouseId());
        StockAdjustment adjustment = stockAdjustmentRepository.save(StockAdjustment.builder()
                .organization(organization)
                .adjustmentNo(nextAdjustmentNo())
                .warehouse(warehouse)
                .adjustmentDate(request.getAdjustmentDate())
                .reason(request.getReason())
                .build());

        applyAdjustmentItems(adjustment, request, organization, warehouse);

        return StockAdjustmentCreateResponseDto.builder()
                .adjustmentId(adjustment.getId())
                .adjustmentNo(adjustment.getAdjustmentNo())
                .build();
    }

    @Override
    @Transactional
    public void updateAdjustment(Long id, StockAdjustmentRequestDto request) {
        Organization organization = currentOrganizationService.getOrganizationReference();
        StockAdjustment adjustment = getAdjustment(id);
        reverseAdjustment(adjustment);
        stockAdjustmentItemRepository.findByStockAdjustmentIdAndOrganizationIdAndIsDeletedFalse(
                        adjustment.getId(),
                        currentOrganizationService.getOrganizationId()
                )
                .forEach(item -> {
                    item.setIsDeleted(true);
                    stockAdjustmentItemRepository.save(item);
                });
        Warehouse warehouse = support.getActiveWarehouse(request.getWarehouseId());
        adjustment.setWarehouse(warehouse);
        adjustment.setAdjustmentDate(request.getAdjustmentDate());
        adjustment.setReason(request.getReason());
        StockAdjustment savedAdjustment = stockAdjustmentRepository.save(adjustment);
        applyAdjustmentItems(savedAdjustment, request, organization, warehouse);
    }

    @Override
    @Transactional
    public void deleteAdjustment(Long id) {
        StockAdjustment adjustment = getAdjustment(id);
        reverseAdjustment(adjustment);
        stockAdjustmentItemRepository.findByStockAdjustmentIdAndOrganizationIdAndIsDeletedFalse(
                        adjustment.getId(),
                        currentOrganizationService.getOrganizationId()
                )
                .forEach(item -> {
                    item.setIsDeleted(true);
                    stockAdjustmentItemRepository.save(item);
                });
        adjustment.setIsDeleted(true);
        stockAdjustmentRepository.save(adjustment);
    }

    @Override
    @Transactional(readOnly = true)
    public PageResponseDto<StockAdjustmentResponseDto> getAdjustments(int page, int size) {
        Page<StockAdjustment> adjustments = stockAdjustmentRepository.findByOrganizationIdAndIsDeletedFalse(
                currentOrganizationService.getOrganizationId(),
                PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "id"))
        );
        return PageResponseDto.from(adjustments.map(this::toResponse));
    }

    @Override
    @Transactional(readOnly = true)
    public StockAdjustmentResponseDto getAdjustmentById(Long id) {
        return toResponse(getAdjustment(id));
    }

    private void applyAdjustmentItems(
            StockAdjustment adjustment,
            StockAdjustmentRequestDto request,
            Organization organization,
            Warehouse warehouse
    ) {
        for (StockAdjustmentItemRequestDto itemRequest : request.getItems()) {
            Item item = support.getActiveItem(itemRequest.getItemId());
            BigDecimal currentQty = support.quantity(itemRequest.getCurrentQty());
            BigDecimal actualQty = support.quantity(itemRequest.getActualQty());
            BigDecimal differenceQty = actualQty.subtract(currentQty);

            stockAdjustmentItemRepository.save(StockAdjustmentItem.builder()
                    .organization(organization)
                    .stockAdjustment(adjustment)
                    .item(item)
                    .currentQty(currentQty)
                    .actualQty(actualQty)
                    .differenceQty(support.quantity(differenceQty))
                    .build());

            if (differenceQty.compareTo(TransactionSupport.ZERO) > 0) {
                support.increaseStock(
                        item,
                        warehouse,
                        differenceQty,
                        TX_ADJUSTMENT_IN,
                        adjustment.getId(),
                        "Stock adjustment " + adjustment.getAdjustmentNo()
                );
            } else if (differenceQty.compareTo(TransactionSupport.ZERO) < 0) {
                support.decreaseStock(
                        item,
                        warehouse,
                        differenceQty.abs(),
                        TX_ADJUSTMENT_OUT,
                        adjustment.getId(),
                        "Stock adjustment " + adjustment.getAdjustmentNo()
                );
            }
        }
    }

    private String nextAdjustmentNo() {
        String currentNumber = stockAdjustmentRepository.findTopByAdjustmentNoStartingWithAndOrganizationIdOrderByIdDesc(
                        PREFIX,
                        currentOrganizationService.getOrganizationId()
                )
                .map(StockAdjustment::getAdjustmentNo)
                .orElse(null);
        return support.nextNumber(PREFIX, currentNumber);
    }

    private StockAdjustment getAdjustment(Long id) {
        return stockAdjustmentRepository.findByIdAndOrganizationIdAndIsDeletedFalse(
                        id,
                        currentOrganizationService.getOrganizationId()
                )
                .orElseThrow(() -> new ResourceNotFoundException("Stock adjustment not found", "STOCK_ADJUSTMENT_NOT_FOUND"));
    }

    private void reverseAdjustment(StockAdjustment adjustment) {
        List<StockAdjustmentItem> items = stockAdjustmentItemRepository
                .findByStockAdjustmentIdAndOrganizationIdAndIsDeletedFalse(
                        adjustment.getId(),
                        currentOrganizationService.getOrganizationId()
                );
        for (StockAdjustmentItem item : items) {
            BigDecimal differenceQty = support.defaultZero(item.getDifferenceQty());
            if (differenceQty.compareTo(TransactionSupport.ZERO) > 0) {
                support.decreaseStock(
                        item.getItem(),
                        adjustment.getWarehouse(),
                        differenceQty,
                        TX_ADJUSTMENT_REVERSE_OUT,
                        adjustment.getId(),
                        "Reverse stock adjustment " + adjustment.getAdjustmentNo()
                );
            } else if (differenceQty.compareTo(TransactionSupport.ZERO) < 0) {
                support.increaseStock(
                        item.getItem(),
                        adjustment.getWarehouse(),
                        differenceQty.abs(),
                        TX_ADJUSTMENT_REVERSE_IN,
                        adjustment.getId(),
                        "Reverse stock adjustment " + adjustment.getAdjustmentNo()
                );
            }
        }
    }

    private StockAdjustmentResponseDto toResponse(StockAdjustment adjustment) {
        return StockAdjustmentResponseDto.builder()
                .adjustmentId(adjustment.getId())
                .adjustmentNo(adjustment.getAdjustmentNo())
                .warehouse(support.toNameId(adjustment.getWarehouse()))
                .adjustmentDate(adjustment.getAdjustmentDate())
                .reason(adjustment.getReason())
                .createdBy(adjustment.getCreatedBy())
                .items(stockAdjustmentItemRepository.findByStockAdjustmentIdAndOrganizationIdAndIsDeletedFalse(
                                adjustment.getId(),
                                currentOrganizationService.getOrganizationId()
                        ).stream()
                        .map(this::toItemResponse)
                        .toList())
                .build();
    }

    private StockAdjustmentItemResponseDto toItemResponse(StockAdjustmentItem item) {
        Item stockItem = item.getItem();
        return StockAdjustmentItemResponseDto.builder()
                .itemId(stockItem == null ? null : stockItem.getId())
                .itemName(stockItem == null ? null : stockItem.getItemName())
                .currentQty(item.getCurrentQty())
                .actualQty(item.getActualQty())
                .differenceQty(item.getDifferenceQty())
                .build();
    }
}


