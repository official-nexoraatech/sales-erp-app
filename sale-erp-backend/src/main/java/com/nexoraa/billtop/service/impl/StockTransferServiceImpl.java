package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.stock.StockTransferCreateResponseDto;
import com.nexoraa.billtop.dto.stock.StockTransferItemRequestDto;
import com.nexoraa.billtop.dto.stock.StockTransferItemResponseDto;
import com.nexoraa.billtop.dto.stock.StockTransferRequestDto;
import com.nexoraa.billtop.dto.stock.StockTransferResponseDto;
import com.nexoraa.billtop.entity.Item;
import com.nexoraa.billtop.entity.ItemBatch;
import com.nexoraa.billtop.entity.Stock;
import com.nexoraa.billtop.entity.StockTransfer;
import com.nexoraa.billtop.entity.StockTransferItem;
import com.nexoraa.billtop.entity.Warehouse;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.repository.StockRepository;
import com.nexoraa.billtop.repository.StockTransferItemRepository;
import com.nexoraa.billtop.repository.StockTransferRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.StockTransferService;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;

@Service
public class StockTransferServiceImpl implements StockTransferService {

    private static final String PREFIX = "TRF-";
    private static final String TX_TRANSFER_OUT = "STOCK_TRANSFER_OUT";
    private static final String TX_TRANSFER_IN = "STOCK_TRANSFER_IN";

    private final StockTransferRepository stockTransferRepository;
    private final StockTransferItemRepository stockTransferItemRepository;
    private final StockRepository stockRepository;
    private final TransactionSupport support;
    private final CurrentOrganizationService currentOrganizationService;

    public StockTransferServiceImpl(
            StockTransferRepository stockTransferRepository,
            StockTransferItemRepository stockTransferItemRepository,
            StockRepository stockRepository,
            TransactionSupport support,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.stockTransferRepository = stockTransferRepository;
        this.stockTransferItemRepository = stockTransferItemRepository;
        this.stockRepository = stockRepository;
        this.support = support;
        this.currentOrganizationService = currentOrganizationService;
    }

    @Override
    @Transactional
    public StockTransferCreateResponseDto transferStock(StockTransferRequestDto request) {
        if (request.getFromWarehouseId().equals(request.getToWarehouseId())) {
            throw new BadRequestException("Source and destination warehouses must be different", "INVALID_STOCK_TRANSFER");
        }
        Warehouse fromWarehouse = support.getActiveWarehouse(request.getFromWarehouseId());
        Warehouse toWarehouse = support.getActiveWarehouse(request.getToWarehouseId());
        StockTransfer transfer = stockTransferRepository.save(StockTransfer.builder()
                .organization(currentOrganizationService.getOrganizationReference())
                .transferNo(nextTransferNo())
                .fromWarehouse(fromWarehouse)
                .toWarehouse(toWarehouse)
                .transferDate(request.getTransferDate())
                .notes(request.getNotes())
                .build());

        for (StockTransferItemRequestDto itemRequest : request.getItems()) {
            transferItem(transfer, support.getActiveItem(itemRequest.getItemId()), itemRequest.getQuantity());
        }

        return StockTransferCreateResponseDto.builder()
                .transferId(transfer.getId())
                .transferNo(transfer.getTransferNo())
                .build();
    }

    @Override
    @Transactional(readOnly = true)
    public PageResponseDto<StockTransferResponseDto> getTransfers(int page, int size) {
        Page<StockTransfer> transfers = stockTransferRepository.findByOrganizationId(
                currentOrganizationService.getOrganizationId(),
                PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "id"))
        );
        return PageResponseDto.from(transfers.map(this::toResponse));
    }

    @Override
    @Transactional(readOnly = true)
    public StockTransferResponseDto getTransferById(Long id) {
        return toResponse(stockTransferRepository.findByIdAndOrganizationId(id, currentOrganizationService.getOrganizationId())
                .orElseThrow(() -> new ResourceNotFoundException("Stock transfer not found", "STOCK_TRANSFER_NOT_FOUND")));
    }

    private void transferItem(StockTransfer transfer, Item item, BigDecimal quantity) {
        BigDecimal remainingQty = quantity;
        for (Stock stock : stockRepository.findByItemIdAndWarehouseIdAndOrganizationIdOrderByIdAsc(
                item.getId(),
                transfer.getFromWarehouse().getId(),
                currentOrganizationService.getOrganizationId()
        )) {
            if (remainingQty.compareTo(TransactionSupport.ZERO) <= 0) {
                break;
            }
            BigDecimal availableQty = support.defaultZero(stock.getAvailableQty());
            if (availableQty.compareTo(TransactionSupport.ZERO) <= 0) {
                continue;
            }
            BigDecimal allocatedQty = availableQty.min(remainingQty);
            ItemBatch batch = stock.getBatch();
            support.decreaseStock(
                    item,
                    transfer.getFromWarehouse(),
                    batch,
                    allocatedQty,
                    TX_TRANSFER_OUT,
                    transfer.getId(),
                    "Stock transfer " + transfer.getTransferNo()
            );
            support.increaseStock(
                    item,
                    transfer.getToWarehouse(),
                    batch,
                    allocatedQty,
                    TX_TRANSFER_IN,
                    transfer.getId(),
                    "Stock transfer " + transfer.getTransferNo()
            );
            stockTransferItemRepository.save(StockTransferItem.builder()
                    .organization(currentOrganizationService.getOrganizationReference())
                    .stockTransfer(transfer)
                    .item(item)
                    .batch(batch)
                    .qty(support.quantity(allocatedQty))
                    .build());
            remainingQty = remainingQty.subtract(allocatedQty);
        }

        if (remainingQty.compareTo(TransactionSupport.ZERO) > 0) {
            throw new BadRequestException(ErrorMessage.INSUFFICIENT_STOCK, "INSUFFICIENT_STOCK");
        }
    }

    private String nextTransferNo() {
        String currentNumber = stockTransferRepository.findTopByTransferNoStartingWithAndOrganizationIdOrderByIdDesc(
                        PREFIX,
                        currentOrganizationService.getOrganizationId()
                )
                .map(StockTransfer::getTransferNo)
                .orElse(null);
        return support.nextNumber(PREFIX, currentNumber);
    }

    private StockTransferResponseDto toResponse(StockTransfer transfer) {
        return StockTransferResponseDto.builder()
                .transferId(transfer.getId())
                .transferNo(transfer.getTransferNo())
                .fromWarehouse(support.toNameId(transfer.getFromWarehouse()))
                .toWarehouse(support.toNameId(transfer.getToWarehouse()))
                .transferDate(transfer.getTransferDate())
                .notes(transfer.getNotes())
                .items(stockTransferItemRepository.findByStockTransferIdAndOrganizationId(
                                transfer.getId(),
                                currentOrganizationService.getOrganizationId()
                        ).stream()
                        .map(this::toItemResponse)
                        .toList())
                .build();
    }

    private StockTransferItemResponseDto toItemResponse(StockTransferItem transferItem) {
        Item item = transferItem.getItem();
        ItemBatch batch = transferItem.getBatch();
        return StockTransferItemResponseDto.builder()
                .itemId(item == null ? null : item.getId())
                .itemName(item == null ? null : item.getItemName())
                .batchId(batch == null ? null : batch.getId())
                .batchNo(batch == null ? null : batch.getBatchNo())
                .quantity(transferItem.getQty())
                .build();
    }
}


