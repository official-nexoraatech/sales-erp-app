package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.purchase.PurchaseCreateResponseDto;
import com.nexoraa.billtop.dto.purchase.PurchaseDetailResponseDto;
import com.nexoraa.billtop.dto.purchase.PurchaseItemRequestDto;
import com.nexoraa.billtop.dto.purchase.PurchaseItemResponseDto;
import com.nexoraa.billtop.dto.purchase.PurchaseListResponseDto;
import com.nexoraa.billtop.dto.purchase.PurchaseRequestDto;
import com.nexoraa.billtop.entity.Contact;
import com.nexoraa.billtop.entity.Item;
import com.nexoraa.billtop.entity.ItemBatch;
import com.nexoraa.billtop.entity.Organization;
import com.nexoraa.billtop.entity.Purchase;
import com.nexoraa.billtop.entity.PurchaseItem;
import com.nexoraa.billtop.entity.Warehouse;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.repository.PurchaseItemRepository;
import com.nexoraa.billtop.repository.PurchaseRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.PurchaseService;
import com.nexoraa.billtop.specification.PurchaseSpecification;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

@Service
public class PurchaseServiceImpl implements PurchaseService {

    private static final String PURCHASE_PREFIX = "PUR-";
    private static final String TX_PURCHASE = "PURCHASE";
    private static final String TX_PURCHASE_REVERSE = "PURCHASE_REVERSE";
    private static final String TX_PURCHASE_CANCEL = "PURCHASE_CANCEL";

    private final PurchaseRepository purchaseRepository;
    private final PurchaseItemRepository purchaseItemRepository;
    private final TransactionSupport support;
    private final CurrentOrganizationService currentOrganizationService;

    public PurchaseServiceImpl(
            PurchaseRepository purchaseRepository,
            PurchaseItemRepository purchaseItemRepository,
            TransactionSupport support,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.purchaseRepository = purchaseRepository;
        this.purchaseItemRepository = purchaseItemRepository;
        this.support = support;
        this.currentOrganizationService = currentOrganizationService;
    }

    @Override
    @Transactional
    public PurchaseCreateResponseDto createPurchase(PurchaseRequestDto request) {
        Organization organization = currentOrganizationService.getOrganizationReference();
        String purchaseNo = nextPurchaseNo();
        PreparedPurchase preparedPurchase = preparePurchase(new Purchase(), request, purchaseNo, organization);
        Purchase savedPurchase = purchaseRepository.save(preparedPurchase.purchase());
        saveItemsAndIncreaseStock(savedPurchase, preparedPurchase.items(), TX_PURCHASE, organization);
        return toCreateResponse(savedPurchase);
    }

    @Override
    @Transactional(readOnly = true)
    public PageResponseDto<PurchaseListResponseDto> getPurchases(
            int page,
            int size,
            String search,
            LocalDate fromDate,
            LocalDate toDate
    ) {
        Specification<Purchase> specification = PurchaseSpecification.notCancelled()
                .and(PurchaseSpecification.organization(currentOrganizationService.getOrganizationId()))
                .and(PurchaseSpecification.search(search))
                .and(PurchaseSpecification.dateBetween(fromDate, toDate));
        Page<Purchase> purchases = purchaseRepository.findAll(
                specification,
                PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "id"))
        );
        return PageResponseDto.from(purchases.map(this::toListResponse));
    }

    @Override
    @Transactional(readOnly = true)
    public PurchaseDetailResponseDto getPurchaseById(Long id) {
        Purchase purchase = getPurchase(id);
        return toDetailResponse(purchase);
    }

    @Override
    @Transactional
    public void updatePurchase(Long id, PurchaseRequestDto request) {
        Organization organization = currentOrganizationService.getOrganizationReference();
        Purchase purchase = getPurchase(id);
        ensureNotCancelled(purchase);

        reversePurchaseStock(purchase, TX_PURCHASE_REVERSE);
        purchaseItemRepository.deleteByPurchaseIdAndOrganizationId(id, currentOrganizationService.getOrganizationId());

        PreparedPurchase preparedPurchase = preparePurchase(purchase, request, purchase.getPurchaseNo(), organization);
        Purchase savedPurchase = purchaseRepository.save(preparedPurchase.purchase());
        saveItemsAndIncreaseStock(savedPurchase, preparedPurchase.items(), TX_PURCHASE, organization);
    }

    @Override
    @Transactional
    public void cancelPurchase(Long id) {
        Purchase purchase = getPurchase(id);
        ensureNotCancelled(purchase);
        reversePurchaseStock(purchase, TX_PURCHASE_CANCEL);
        purchase.setStatus(TransactionSupport.STATUS_CANCELLED);
        purchaseRepository.save(purchase);
    }

    private PreparedPurchase preparePurchase(
            Purchase purchase,
            PurchaseRequestDto request,
            String purchaseNo,
            Organization organization
    ) {
        Contact supplier = support.getActiveSupplier(request.getSupplierId());
        Warehouse warehouse = support.getActiveWarehouse(request.getWarehouseId());
        List<PreparedPurchaseItem> items = new ArrayList<>();
        purchase.setOrganization(organization);

        BigDecimal subTotal = TransactionSupport.ZERO;
        BigDecimal discountAmount = TransactionSupport.ZERO;
        BigDecimal taxAmount = TransactionSupport.ZERO;
        BigDecimal grandTotal = TransactionSupport.ZERO;

        for (PurchaseItemRequestDto itemRequest : request.getItems()) {
            Item item = support.getActiveItem(itemRequest.getItemId());
            ItemBatch batch = support.getOrCreateBatch(item, itemRequest);
            TransactionSupport.LineTotals lineTotals = support.calculateLine(
                    itemRequest.getQuantity(),
                    itemRequest.getUnitPrice(),
                    itemRequest.getDiscountPercent(),
                    itemRequest.getTaxPercent()
            );
            subTotal = subTotal.add(lineTotals.grossAmount());
            discountAmount = discountAmount.add(lineTotals.discountAmount());
            taxAmount = taxAmount.add(lineTotals.taxAmount());
            grandTotal = grandTotal.add(lineTotals.totalAmount());
            items.add(new PreparedPurchaseItem(item, batch, itemRequest, lineTotals));
        }

        BigDecimal paidAmount = support.money(support.defaultZero(purchase.getPaidAmount()));
        purchase.setPurchaseNo(purchaseNo);
        purchase.setSupplier(supplier);
        purchase.setPurchaseDate(request.getPurchaseDate());
        purchase.setReferenceNo(request.getReferenceNo());
        purchase.setWarehouse(warehouse);
        purchase.setCarrier(support.getActiveCarrier(request.getCarrierId()));
        purchase.setState(support.getActiveState(request.getStateId()));
        purchase.setSubTotal(support.money(subTotal));
        purchase.setDiscountAmount(support.money(discountAmount));
        purchase.setTaxAmount(support.money(taxAmount));
        purchase.setRoundOff(TransactionSupport.ZERO);
        purchase.setGrandTotal(support.money(grandTotal));
        purchase.setPaidAmount(paidAmount);
        purchase.setDueAmount(support.money(grandTotal.subtract(paidAmount)));
        purchase.setStatus(TransactionSupport.STATUS_ACTIVE);
        purchase.setNotes(request.getNotes());
        return new PreparedPurchase(purchase, items);
    }

    private void saveItemsAndIncreaseStock(
            Purchase purchase,
            List<PreparedPurchaseItem> items,
            String transactionType,
            Organization organization
    ) {
        for (PreparedPurchaseItem preparedItem : items) {
            PurchaseItem purchaseItem = PurchaseItem.builder()
                    .organization(organization)
                    .purchase(purchase)
                    .item(preparedItem.item())
                    .batch(preparedItem.batch())
                    .qty(support.quantity(preparedItem.request().getQuantity()))
                    .unitPrice(support.money(preparedItem.request().getUnitPrice()))
                    .discountPercent(support.defaultZero(preparedItem.request().getDiscountPercent()))
                    .discountAmount(preparedItem.totals().discountAmount())
                    .taxPercent(support.defaultZero(preparedItem.request().getTaxPercent()))
                    .taxAmount(preparedItem.totals().taxAmount())
                    .totalAmount(preparedItem.totals().totalAmount())
                    .build();
            purchaseItemRepository.save(purchaseItem);
            support.increaseStock(
                    preparedItem.item(),
                    purchase.getWarehouse(),
                    preparedItem.batch(),
                    preparedItem.request().getQuantity(),
                    transactionType,
                    purchase.getId(),
                    "Purchase " + purchase.getPurchaseNo()
            );
        }
    }

    private void reversePurchaseStock(Purchase purchase, String transactionType) {
        for (PurchaseItem purchaseItem : purchaseItemRepository.findByPurchaseIdAndOrganizationId(
                purchase.getId(),
                currentOrganizationService.getOrganizationId()
        )) {
            support.decreaseStock(
                    purchaseItem.getItem(),
                    purchase.getWarehouse(),
                    purchaseItem.getBatch(),
                    purchaseItem.getQty(),
                    transactionType,
                    purchase.getId(),
                    "Purchase " + purchase.getPurchaseNo()
            );
        }
    }

    private Purchase getPurchase(Long id) {
        return purchaseRepository.findByIdAndOrganizationId(id, currentOrganizationService.getOrganizationId())
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.PURCHASE_NOT_FOUND, "PURCHASE_NOT_FOUND"));
    }

    private void ensureNotCancelled(Purchase purchase) {
        if (support.isCancelled(purchase.getStatus())) {
            throw new BadRequestException(ErrorMessage.PURCHASE_ALREADY_CANCELLED, "PURCHASE_ALREADY_CANCELLED");
        }
    }

    private String nextPurchaseNo() {
        String currentNumber = purchaseRepository.findTopByPurchaseNoStartingWithAndOrganizationIdOrderByIdDesc(
                        PURCHASE_PREFIX,
                        currentOrganizationService.getOrganizationId()
                )
                .map(Purchase::getPurchaseNo)
                .orElse(null);
        return support.nextNumber(PURCHASE_PREFIX, currentNumber);
    }

    private PurchaseCreateResponseDto toCreateResponse(Purchase purchase) {
        return PurchaseCreateResponseDto.builder()
                .purchaseId(purchase.getId())
                .purchaseNo(purchase.getPurchaseNo())
                .subTotal(purchase.getSubTotal())
                .discountAmount(purchase.getDiscountAmount())
                .taxAmount(purchase.getTaxAmount())
                .grandTotal(purchase.getGrandTotal())
                .paidAmount(purchase.getPaidAmount())
                .dueAmount(purchase.getDueAmount())
                .build();
    }

    private PurchaseListResponseDto toListResponse(Purchase purchase) {
        return PurchaseListResponseDto.builder()
                .purchaseId(purchase.getId())
                .purchaseNo(purchase.getPurchaseNo())
                .supplierName(support.contactDisplayName(purchase.getSupplier()))
                .purchaseDate(purchase.getPurchaseDate())
                .grandTotal(purchase.getGrandTotal())
                .paidAmount(purchase.getPaidAmount())
                .dueAmount(purchase.getDueAmount())
                .build();
    }

    private PurchaseDetailResponseDto toDetailResponse(Purchase purchase) {
        return PurchaseDetailResponseDto.builder()
                .purchaseId(purchase.getId())
                .purchaseNo(purchase.getPurchaseNo())
                .purchaseDate(purchase.getPurchaseDate())
                .referenceNo(purchase.getReferenceNo())
                .supplier(support.toNameId(purchase.getSupplier()))
                .warehouse(support.toNameId(purchase.getWarehouse()))
                .subTotal(purchase.getSubTotal())
                .discountAmount(purchase.getDiscountAmount())
                .taxAmount(purchase.getTaxAmount())
                .grandTotal(purchase.getGrandTotal())
                .paidAmount(purchase.getPaidAmount())
                .dueAmount(purchase.getDueAmount())
                .status(purchase.getStatus())
                .notes(purchase.getNotes())
                .items(purchaseItemRepository.findByPurchaseIdAndOrganizationId(
                                purchase.getId(),
                                currentOrganizationService.getOrganizationId()
                        ).stream()
                        .map(this::toItemResponse)
                        .toList())
                .build();
    }

    private PurchaseItemResponseDto toItemResponse(PurchaseItem purchaseItem) {
        Item item = purchaseItem.getItem();
        ItemBatch batch = purchaseItem.getBatch();
        return PurchaseItemResponseDto.builder()
                .itemId(item == null ? null : item.getId())
                .itemName(item == null ? null : item.getItemName())
                .batchId(batch == null ? null : batch.getId())
                .batchNo(batch == null ? null : batch.getBatchNo())
                .qty(purchaseItem.getQty())
                .unitPrice(purchaseItem.getUnitPrice())
                .discountAmount(purchaseItem.getDiscountAmount())
                .taxAmount(purchaseItem.getTaxAmount())
                .totalAmount(purchaseItem.getTotalAmount())
                .build();
    }

    private record PreparedPurchase(Purchase purchase, List<PreparedPurchaseItem> items) {
    }

    private record PreparedPurchaseItem(
            Item item,
            ItemBatch batch,
            PurchaseItemRequestDto request,
            TransactionSupport.LineTotals totals
    ) {
    }
}


