package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.stock.StockAdjustmentCreateResponseDto;
import com.nexoraa.billtop.dto.stock.StockAdjustmentItemRequestDto;
import com.nexoraa.billtop.dto.stock.StockAdjustmentItemResponseDto;
import com.nexoraa.billtop.dto.stock.StockAdjustmentRequestDto;
import com.nexoraa.billtop.dto.stock.StockAdjustmentResponseDto;
import com.nexoraa.billtop.entity.Item;
import com.nexoraa.billtop.entity.ItemBatch;
import com.nexoraa.billtop.entity.Organization;
import com.nexoraa.billtop.entity.Stock;
import com.nexoraa.billtop.entity.StockAdjustment;
import com.nexoraa.billtop.entity.StockAdjustmentItem;
import com.nexoraa.billtop.entity.Warehouse;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.repository.ItemBatchRepository;
import com.nexoraa.billtop.repository.StockAdjustmentItemRepository;
import com.nexoraa.billtop.repository.StockAdjustmentRepository;
import com.nexoraa.billtop.repository.StockRepository;
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

    private final StockAdjustmentRepository stockAdjustmentRepository;
    private final StockAdjustmentItemRepository stockAdjustmentItemRepository;
    private final StockRepository stockRepository;
    private final ItemBatchRepository itemBatchRepository;
    private final TransactionSupport support;
    private final CurrentOrganizationService currentOrganizationService;

    public StockAdjustmentServiceImpl(
            StockAdjustmentRepository stockAdjustmentRepository,
            StockAdjustmentItemRepository stockAdjustmentItemRepository,
            StockRepository stockRepository,
            ItemBatchRepository itemBatchRepository,
            TransactionSupport support,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.stockAdjustmentRepository = stockAdjustmentRepository;
        this.stockAdjustmentItemRepository = stockAdjustmentItemRepository;
        this.stockRepository = stockRepository;
        this.itemBatchRepository = itemBatchRepository;
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

        for (StockAdjustmentItemRequestDto itemRequest : request.getItems()) {
            Item item = support.getActiveItem(itemRequest.getItemId());
            BigDecimal currentQty = support.quantity(itemRequest.getCurrentQty());
            BigDecimal actualQty = support.quantity(itemRequest.getActualQty());
            BigDecimal differenceQty = actualQty.subtract(currentQty);
            ItemBatch batch = resolveBatch(item, warehouse);

            stockAdjustmentItemRepository.save(StockAdjustmentItem.builder()
                    .organization(organization)
                    .stockAdjustment(adjustment)
                    .item(item)
                    .batch(batch)
                    .currentQty(currentQty)
                    .actualQty(actualQty)
                    .differenceQty(support.quantity(differenceQty))
                    .build());

            if (differenceQty.compareTo(TransactionSupport.ZERO) > 0) {
                support.increaseStock(
                        item,
                        warehouse,
                        batch,
                        differenceQty,
                        TX_ADJUSTMENT_IN,
                        adjustment.getId(),
                        "Stock adjustment " + adjustment.getAdjustmentNo()
                );
            } else if (differenceQty.compareTo(TransactionSupport.ZERO) < 0) {
                decreaseAcrossBatches(item, warehouse, differenceQty.abs(), adjustment);
            }
        }

        return StockAdjustmentCreateResponseDto.builder()
                .adjustmentId(adjustment.getId())
                .adjustmentNo(adjustment.getAdjustmentNo())
                .build();
    }

    @Override
    @Transactional(readOnly = true)
    public PageResponseDto<StockAdjustmentResponseDto> getAdjustments(int page, int size) {
        Page<StockAdjustment> adjustments = stockAdjustmentRepository.findByOrganizationId(
                currentOrganizationService.getOrganizationId(),
                PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "id"))
        );
        return PageResponseDto.from(adjustments.map(this::toResponse));
    }

    @Override
    @Transactional(readOnly = true)
    public StockAdjustmentResponseDto getAdjustmentById(Long id) {
        return toResponse(stockAdjustmentRepository.findByIdAndOrganizationId(id, currentOrganizationService.getOrganizationId())
                .orElseThrow(() -> new ResourceNotFoundException("Stock adjustment not found", "STOCK_ADJUSTMENT_NOT_FOUND")));
    }

    private void decreaseAcrossBatches(Item item, Warehouse warehouse, BigDecimal quantity, StockAdjustment adjustment) {
        BigDecimal remainingQty = quantity;
        for (Stock stock : stockRepository.findByItemIdAndWarehouseIdOrderByIdAsc(
                item.getId(),
                warehouse.getId()
        )) {
            if (remainingQty.compareTo(TransactionSupport.ZERO) <= 0) {
                break;
            }
            BigDecimal availableQty = support.defaultZero(stock.getAvailableQty());
            if (availableQty.compareTo(TransactionSupport.ZERO) <= 0) {
                continue;
            }
            BigDecimal allocatedQty = availableQty.min(remainingQty);
            support.decreaseStock(
                    item,
                    warehouse,
                    stock.getBatch(),
                    allocatedQty,
                    TX_ADJUSTMENT_OUT,
                    adjustment.getId(),
                    "Stock adjustment " + adjustment.getAdjustmentNo()
            );
            remainingQty = remainingQty.subtract(allocatedQty);
        }
        if (remainingQty.compareTo(TransactionSupport.ZERO) > 0) {
            throw new BadRequestException(ErrorMessage.INSUFFICIENT_STOCK, "INSUFFICIENT_STOCK");
        }
    }

    private ItemBatch resolveBatch(Item item, Warehouse warehouse) {
        return stockRepository.findByItemIdAndWarehouseIdOrderByIdAsc(
                        item.getId(),
                        warehouse.getId()
                ).stream()
                .map(Stock::getBatch)
                .findFirst()
                .orElseGet(() -> itemBatchRepository.findTopByItemIdOrderByIdDesc(item.getId())
                        .orElseGet(() -> itemBatchRepository.save(ItemBatch.builder()
                                .item(item)
                                .batchNo("ADJ-" + item.getId())
                                .build())));
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

    private StockAdjustmentResponseDto toResponse(StockAdjustment adjustment) {
        return StockAdjustmentResponseDto.builder()
                .adjustmentId(adjustment.getId())
                .adjustmentNo(adjustment.getAdjustmentNo())
                .warehouse(support.toNameId(adjustment.getWarehouse()))
                .adjustmentDate(adjustment.getAdjustmentDate())
                .reason(adjustment.getReason())
                .items(stockAdjustmentItemRepository.findByStockAdjustmentIdAndOrganizationId(
                                adjustment.getId(),
                                currentOrganizationService.getOrganizationId()
                        ).stream()
                        .map(this::toItemResponse)
                        .toList())
                .build();
    }

    private StockAdjustmentItemResponseDto toItemResponse(StockAdjustmentItem item) {
        Item stockItem = item.getItem();
        ItemBatch batch = item.getBatch();
        return StockAdjustmentItemResponseDto.builder()
                .itemId(stockItem == null ? null : stockItem.getId())
                .itemName(stockItem == null ? null : stockItem.getItemName())
                .batchId(batch == null ? null : batch.getId())
                .batchNo(batch == null ? null : batch.getBatchNo())
                .currentQty(item.getCurrentQty())
                .actualQty(item.getActualQty())
                .differenceQty(item.getDifferenceQty())
                .build();
    }
}


