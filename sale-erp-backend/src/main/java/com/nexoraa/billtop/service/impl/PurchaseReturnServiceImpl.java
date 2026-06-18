package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.purchase.PurchaseReturnCreateResponseDto;
import com.nexoraa.billtop.dto.purchase.PurchaseReturnRequestDto;
import com.nexoraa.billtop.dto.returning.ReturnDetailResponseDto;
import com.nexoraa.billtop.dto.returning.ReturnItemRequestDto;
import com.nexoraa.billtop.dto.returning.ReturnItemResponseDto;
import com.nexoraa.billtop.dto.returning.ReturnListResponseDto;
import com.nexoraa.billtop.entity.Contact;
import com.nexoraa.billtop.entity.Item;
import com.nexoraa.billtop.entity.ItemBatch;
import com.nexoraa.billtop.entity.Purchase;
import com.nexoraa.billtop.entity.PurchaseReturn;
import com.nexoraa.billtop.entity.PurchaseReturnItem;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.repository.PurchaseRepository;
import com.nexoraa.billtop.repository.PurchaseReturnItemRepository;
import com.nexoraa.billtop.repository.PurchaseReturnRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.PurchaseReturnService;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

@Service
public class PurchaseReturnServiceImpl implements PurchaseReturnService {

    private static final String RETURN_PREFIX = "PR-";
    private static final String TX_PURCHASE_RETURN = "PURCHASE_RETURN";

    private final PurchaseReturnRepository purchaseReturnRepository;
    private final PurchaseReturnItemRepository purchaseReturnItemRepository;
    private final PurchaseRepository purchaseRepository;
    private final TransactionSupport support;
    private final CurrentOrganizationService currentOrganizationService;

    public PurchaseReturnServiceImpl(
            PurchaseReturnRepository purchaseReturnRepository,
            PurchaseReturnItemRepository purchaseReturnItemRepository,
            PurchaseRepository purchaseRepository,
            TransactionSupport support,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.purchaseReturnRepository = purchaseReturnRepository;
        this.purchaseReturnItemRepository = purchaseReturnItemRepository;
        this.purchaseRepository = purchaseRepository;
        this.support = support;
        this.currentOrganizationService = currentOrganizationService;
    }

    @Override
    @Transactional
    public PurchaseReturnCreateResponseDto createPurchaseReturn(PurchaseReturnRequestDto request) {
        Purchase purchase = getPurchase(request.getPurchaseId());
        if (support.isCancelled(purchase.getStatus())) {
            throw new BadRequestException(ErrorMessage.PURCHASE_ALREADY_CANCELLED, "PURCHASE_ALREADY_CANCELLED");
        }

        Contact supplier = support.getActiveSupplier(request.getSupplierId());
        if (purchase.getSupplier() != null && !purchase.getSupplier().getId().equals(supplier.getId())) {
            throw new BadRequestException("Supplier does not match purchase", "SUPPLIER_PURCHASE_MISMATCH");
        }

        List<PreparedReturnItem> items = new ArrayList<>();
        BigDecimal grandTotal = TransactionSupport.ZERO;
        for (ReturnItemRequestDto itemRequest : request.getItems()) {
            Item item = support.getActiveItem(itemRequest.getItemId());
            ItemBatch batch = support.getBatchForItem(itemRequest.getBatchId(), item.getId());
            BigDecimal amount = support.amount(itemRequest.getQuantity(), itemRequest.getRate());
            grandTotal = grandTotal.add(amount);
            items.add(new PreparedReturnItem(item, batch, itemRequest, amount));
        }

        PurchaseReturn purchaseReturn = PurchaseReturn.builder()
                .organization(currentOrganizationService.getOrganizationReference())
                .returnNo(nextReturnNo())
                .purchase(purchase)
                .supplier(supplier)
                .returnDate(request.getReturnDate())
                .subTotal(support.money(grandTotal))
                .discountAmount(TransactionSupport.ZERO)
                .taxAmount(TransactionSupport.ZERO)
                .grandTotal(support.money(grandTotal))
                .notes(request.getReason())
                .build();
        PurchaseReturn savedReturn = purchaseReturnRepository.save(purchaseReturn);
        for (PreparedReturnItem item : items) {
            purchaseReturnItemRepository.save(PurchaseReturnItem.builder()
                    .organization(currentOrganizationService.getOrganizationReference())
                    .purchaseReturn(savedReturn)
                    .item(item.item())
                    .batch(item.batch())
                    .qty(support.quantity(item.request().getQuantity()))
                    .rate(support.money(item.request().getRate()))
                    .amount(item.amount())
                    .build());
            support.decreaseStock(
                    item.item(),
                    purchase.getWarehouse(),
                    item.batch(),
                    item.request().getQuantity(),
                    TX_PURCHASE_RETURN,
                    savedReturn.getId(),
                    "Purchase return " + savedReturn.getReturnNo()
            );
        }

        return PurchaseReturnCreateResponseDto.builder()
                .returnId(savedReturn.getId())
                .returnNo(savedReturn.getReturnNo())
                .grandTotal(savedReturn.getGrandTotal())
                .build();
    }

    @Override
    @Transactional(readOnly = true)
    public PageResponseDto<ReturnListResponseDto> getPurchaseReturns(int page, int size) {
        Page<PurchaseReturn> returns = purchaseReturnRepository.findByOrganizationId(
                currentOrganizationService.getOrganizationId(),
                PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "id"))
        );
        return PageResponseDto.from(returns.map(this::toListResponse));
    }

    @Override
    @Transactional(readOnly = true)
    public ReturnDetailResponseDto getPurchaseReturnById(Long id) {
        PurchaseReturn purchaseReturn = purchaseReturnRepository.findByIdAndOrganizationId(id, currentOrganizationService.getOrganizationId())
                .orElseThrow(() -> new ResourceNotFoundException(
                        ErrorMessage.PURCHASE_RETURN_NOT_FOUND,
                        "PURCHASE_RETURN_NOT_FOUND"
                ));
        return ReturnDetailResponseDto.builder()
                .returnId(purchaseReturn.getId())
                .returnNo(purchaseReturn.getReturnNo())
                .returnDate(purchaseReturn.getReturnDate())
                .party(support.toNameId(purchaseReturn.getSupplier()))
                .reason(purchaseReturn.getNotes())
                .subTotal(purchaseReturn.getSubTotal())
                .discountAmount(purchaseReturn.getDiscountAmount())
                .taxAmount(purchaseReturn.getTaxAmount())
                .grandTotal(purchaseReturn.getGrandTotal())
                .items(purchaseReturnItemRepository.findByPurchaseReturnIdAndOrganizationId(
                                id,
                                currentOrganizationService.getOrganizationId()
                        ).stream()
                        .map(this::toItemResponse)
                        .toList())
                .build();
    }

    private Purchase getPurchase(Long id) {
        return purchaseRepository.findByIdAndOrganizationId(id, currentOrganizationService.getOrganizationId())
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.PURCHASE_NOT_FOUND, "PURCHASE_NOT_FOUND"));
    }

    private String nextReturnNo() {
        String currentNumber = purchaseReturnRepository.findTopByOrganizationIdOrderByIdDesc(
                        currentOrganizationService.getOrganizationId()
                )
                .map(PurchaseReturn::getReturnNo)
                .orElse(null);
        return support.nextNumber(RETURN_PREFIX, currentNumber);
    }

    private ReturnListResponseDto toListResponse(PurchaseReturn purchaseReturn) {
        return ReturnListResponseDto.builder()
                .returnId(purchaseReturn.getId())
                .returnNo(purchaseReturn.getReturnNo())
                .partyName(support.contactDisplayName(purchaseReturn.getSupplier()))
                .returnDate(purchaseReturn.getReturnDate())
                .grandTotal(purchaseReturn.getGrandTotal())
                .build();
    }

    private ReturnItemResponseDto toItemResponse(PurchaseReturnItem purchaseReturnItem) {
        Item item = purchaseReturnItem.getItem();
        ItemBatch batch = purchaseReturnItem.getBatch();
        return ReturnItemResponseDto.builder()
                .itemId(item == null ? null : item.getId())
                .itemName(item == null ? null : item.getItemName())
                .batchId(batch == null ? null : batch.getId())
                .batchNo(batch == null ? null : batch.getBatchNo())
                .quantity(purchaseReturnItem.getQty())
                .rate(purchaseReturnItem.getRate())
                .amount(purchaseReturnItem.getAmount())
                .build();
    }

    private record PreparedReturnItem(
            Item item,
            ItemBatch batch,
            ReturnItemRequestDto request,
            BigDecimal amount
    ) {
    }
}
