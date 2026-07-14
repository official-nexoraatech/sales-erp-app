package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.sales.SalesCreateResponseDto;
import com.nexoraa.billtop.dto.sales.SalesDetailResponseDto;
import com.nexoraa.billtop.dto.sales.SalesInvoiceResponseDto;
import com.nexoraa.billtop.dto.sales.SalesItemRequestDto;
import com.nexoraa.billtop.dto.sales.SalesItemResponseDto;
import com.nexoraa.billtop.dto.sales.SalesListResponseDto;
import com.nexoraa.billtop.dto.sales.SalesRequestDto;
import com.nexoraa.billtop.entity.Contact;
import com.nexoraa.billtop.entity.Item;
import com.nexoraa.billtop.entity.ItemBatch;
import com.nexoraa.billtop.entity.Organization;
import com.nexoraa.billtop.entity.Sale;
import com.nexoraa.billtop.entity.SalesItem;
import com.nexoraa.billtop.entity.Stock;
import com.nexoraa.billtop.entity.Warehouse;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.repository.SaleRepository;
import com.nexoraa.billtop.repository.SalesItemRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.SalesService;
import com.nexoraa.billtop.specification.SaleSpecification;
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
public class SalesServiceImpl implements SalesService {

    private static final String INVOICE_PREFIX = "INV-";
    private static final String TX_SALE = "SALE";
    private static final String TX_SALE_REVERSE = "SALE_REVERSE";
    private static final String TX_SALE_CANCEL = "SALE_CANCEL";

    private final SaleRepository saleRepository;
    private final SalesItemRepository salesItemRepository;
    private final TransactionSupport support;
    private final CurrentOrganizationService currentOrganizationService;

    public SalesServiceImpl(
            SaleRepository saleRepository,
            SalesItemRepository salesItemRepository,
            TransactionSupport support,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.saleRepository = saleRepository;
        this.salesItemRepository = salesItemRepository;
        this.support = support;
        this.currentOrganizationService = currentOrganizationService;
    }

    @Override
    @Transactional
    public SalesCreateResponseDto createSale(SalesRequestDto request) {
        Organization organization = currentOrganizationService.getOrganizationReference();
        String invoiceNo = nextInvoiceNo(INVOICE_PREFIX);
        PreparedSale preparedSale = prepareSale(new Sale(), request, invoiceNo, organization, false);
        Sale savedSale = saleRepository.save(preparedSale.sale());
        saveItems(savedSale, preparedSale.items(), TX_SALE, organization, false);
        return toCreateResponse(savedSale);
    }

    @Override
    @Transactional(readOnly = true)
    public PageResponseDto<SalesListResponseDto> getSales(
            int page,
            int size,
            String search,
            LocalDate fromDate,
            LocalDate toDate,
            List<String> status
    ) {
        Specification<Sale> specification = SaleSpecification.notCancelled()
                .and(SaleSpecification.notDeleted())
                .and(SaleSpecification.organization(currentOrganizationService.getOrganizationId()))
                .and(SaleSpecification.search(search))
                .and(SaleSpecification.dateBetween(fromDate, toDate))
                .and(SaleSpecification.statusIn(status));
        Page<Sale> sales = saleRepository.findAll(
                specification,
                PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "id"))
        );
        return PageResponseDto.from(sales.map(this::toListResponse));
    }

    @Override
    @Transactional(readOnly = true)
    public SalesDetailResponseDto getSaleById(Long id) {
        Sale sale = getSale(id);
        return toDetailResponse(sale);
    }

    @Override
    @Transactional
    public void updateSale(Long id, SalesRequestDto request) {
        Organization organization = currentOrganizationService.getOrganizationReference();
        Sale sale = getSale(id);
        ensureNotCancelled(sale);

        boolean commitStock = !isPending(sale);
        if (commitStock) {
            reverseSaleStock(sale, TX_SALE_REVERSE);
        }
        salesItemRepository.deleteBySaleIdAndOrganizationId(id, currentOrganizationService.getOrganizationId());

        PreparedSale preparedSale = prepareSale(sale, request, sale.getInvoiceNo(), organization, commitStock);
        Sale savedSale = saleRepository.save(preparedSale.sale());
        saveItems(savedSale, preparedSale.items(), TX_SALE, organization, commitStock);
    }

    @Override
    @Transactional
    public void cancelSale(Long id) {
        Sale sale = getSale(id);
        ensureNotCancelled(sale);
        if (!isPending(sale)) {
            reverseSaleStock(sale, TX_SALE_CANCEL);
        }
        sale.setStatus(TransactionSupport.STATUS_CANCELLED);
        saleRepository.save(sale);
    }

    @Override
    @Transactional
    public void deleteSale(Long id) {
        Sale sale = getSale(id);
        if (support.defaultZero(sale.getPaidAmount()).compareTo(TransactionSupport.ZERO) > 0) {
            throw new BadRequestException(ErrorMessage.SALE_HAS_PAYMENTS, "SALE_HAS_PAYMENTS");
        }
        if (!support.isCancelled(sale.getStatus()) && !isPending(sale)) {
            reverseSaleStock(sale, TX_SALE_CANCEL);
        }
        sale.setIsDeleted(true);
        saleRepository.save(sale);
    }

    @Override
    @Transactional
    public void commitSaleStock(Long id) {
        Sale sale = getSale(id);
        if (!isPending(sale)) {
            return;
        }
        Organization organization = sale.getOrganization();
        List<SalesItem> placeholders = salesItemRepository.findBySaleIdAndOrganizationId(
                id,
                currentOrganizationService.getOrganizationId()
        );
        salesItemRepository.deleteAll(placeholders);
        for (SalesItem placeholder : placeholders) {
            Item item = placeholder.getItem();
            List<BatchAllocation> allocations = getAvailableBatches(item, sale.getWarehouse(), placeholder.getQty());
            for (BatchAllocation allocation : allocations) {
                saveAllocatedItem(
                        sale,
                        item,
                        allocation,
                        placeholder.getUnitPrice(),
                        placeholder.getDiscountPercent(),
                        placeholder.getTaxPercent(),
                        TX_SALE,
                        organization,
                        true
                );
            }
        }
        sale.setStatus(TransactionSupport.STATUS_ACTIVE);
        saleRepository.save(sale);
    }

    @Override
    @Transactional(readOnly = true)
    public SalesInvoiceResponseDto getInvoice(Long id) {
        Sale sale = getSale(id);
        return SalesInvoiceResponseDto.builder()
                .invoiceNo(sale.getInvoiceNo())
                .customerName(support.contactDisplayName(sale.getCustomer()))
                .grandTotal(sale.getGrandTotal())
                .build();
    }

    private PreparedSale prepareSale(
            Sale sale,
            SalesRequestDto request,
            String invoiceNo,
            Organization organization,
            boolean commitStock
    ) {
        Contact customer = support.getActiveCustomer(request.getCustomerId());
        Warehouse warehouse = support.getActiveWarehouse(request.getWarehouseId());
        List<PreparedSalesItem> items = new ArrayList<>();
        sale.setOrganization(organization);

        BigDecimal subTotal = TransactionSupport.ZERO;
        BigDecimal discountAmount = TransactionSupport.ZERO;
        BigDecimal taxAmount = TransactionSupport.ZERO;
        BigDecimal grandTotal = TransactionSupport.ZERO;

        for (SalesItemRequestDto itemRequest : request.getItems()) {
            Item item = support.getActiveItem(itemRequest.getItemId());
            List<BatchAllocation> allocations = commitStock
                    ? getAvailableBatches(item, warehouse, itemRequest.getQuantity())
                    : List.of(new BatchAllocation(null, itemRequest.getQuantity()));
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
            items.add(new PreparedSalesItem(item, allocations, itemRequest));
        }

        BigDecimal paidAmount = support.money(support.defaultZero(sale.getPaidAmount()));
        BigDecimal roundOff = support.money(request.getRoundOff());
        BigDecimal finalGrandTotal = support.money(grandTotal.add(roundOff));
        sale.setInvoiceNo(invoiceNo);
        sale.setInvoiceDate(request.getInvoiceDate());
        sale.setCustomer(customer);
        sale.setWarehouse(warehouse);
        sale.setState(support.getActiveState(optionalId(request.getStateId())));
        sale.setSalesPerson(support.getActiveUser(optionalId(request.getSalesPersonId())));
        sale.setSubTotal(support.money(subTotal));
        sale.setDiscountAmount(support.money(discountAmount));
        sale.setTaxAmount(support.money(taxAmount));
        sale.setRoundOff(roundOff);
        sale.setGrandTotal(finalGrandTotal);
        sale.setPaidAmount(paidAmount);
        sale.setDueAmount(support.money(finalGrandTotal.subtract(paidAmount)));
        sale.setStatus(commitStock ? TransactionSupport.STATUS_ACTIVE : TransactionSupport.STATUS_PENDING);
        sale.setNotes(request.getNotes());
        return new PreparedSale(sale, items);
    }

    private List<BatchAllocation> getAvailableBatches(Item item, Warehouse warehouse, BigDecimal requiredQuantity) {
        List<BatchAllocation> allocations = new ArrayList<>();
        BigDecimal remaining = requiredQuantity;
        for (Stock stock : support.getStocksForItemAndWarehouse(item.getId(), warehouse.getId())) {
            if (remaining.compareTo(TransactionSupport.ZERO) <= 0) {
                break;
            }
            if (stock.getBatch() == null) {
                continue;
            }
            BigDecimal availableQty = support.defaultZero(stock.getAvailableQty());
            if (availableQty.compareTo(TransactionSupport.ZERO) <= 0) {
                continue;
            }
            BigDecimal allocatedQty = availableQty.min(remaining);
            allocations.add(new BatchAllocation(stock.getBatch(), allocatedQty));
            remaining = remaining.subtract(allocatedQty);
        }
        if (remaining.compareTo(TransactionSupport.ZERO) > 0) {
            throw new BadRequestException(ErrorMessage.INSUFFICIENT_STOCK, "INSUFFICIENT_STOCK");
        }
        return allocations;
    }

    private void saveItems(
            Sale sale,
            List<PreparedSalesItem> items,
            String transactionType,
            Organization organization,
            boolean commitStock
    ) {
        for (PreparedSalesItem preparedItem : items) {
            for (BatchAllocation allocation : preparedItem.allocations()) {
                saveAllocatedItem(
                        sale,
                        preparedItem.item(),
                        allocation,
                        preparedItem.request().getUnitPrice(),
                        preparedItem.request().getDiscountPercent(),
                        preparedItem.request().getTaxPercent(),
                        transactionType,
                        organization,
                        commitStock
                );
            }
        }
    }

    private void saveAllocatedItem(
            Sale sale,
            Item item,
            BatchAllocation allocation,
            BigDecimal unitPrice,
            BigDecimal discountPercent,
            BigDecimal taxPercent,
            String transactionType,
            Organization organization,
            boolean commitStock
    ) {
        TransactionSupport.LineTotals lineTotals = support.calculateLine(allocation.qty(), unitPrice, discountPercent, taxPercent);
        SalesItem salesItem = SalesItem.builder()
                .organization(organization)
                .sale(sale)
                .item(item)
                .batch(allocation.batch())
                .qty(support.quantity(allocation.qty()))
                .unitPrice(support.money(unitPrice))
                .discountPercent(support.defaultZero(discountPercent))
                .discountAmount(lineTotals.discountAmount())
                .taxPercent(support.defaultZero(taxPercent))
                .taxAmount(lineTotals.taxAmount())
                .totalAmount(lineTotals.totalAmount())
                .build();
        salesItemRepository.save(salesItem);
        if (commitStock) {
            support.decreaseStock(
                    item,
                    sale.getWarehouse(),
                    allocation.batch(),
                    allocation.qty(),
                    transactionType,
                    sale.getId(),
                    "Sales invoice " + sale.getInvoiceNo()
            );
        }
    }

    private void reverseSaleStock(Sale sale, String transactionType) {
        for (SalesItem salesItem : salesItemRepository.findBySaleIdAndOrganizationId(
                sale.getId(),
                currentOrganizationService.getOrganizationId()
        )) {
            support.increaseStock(
                    salesItem.getItem(),
                    sale.getWarehouse(),
                    salesItem.getBatch(),
                    salesItem.getQty(),
                    transactionType,
                    sale.getId(),
                    "Sales invoice " + sale.getInvoiceNo()
            );
        }
    }

    String nextInvoiceNo(String prefix) {
        String currentNumber = saleRepository.findTopByInvoiceNoStartingWithAndOrganizationIdOrderByIdDesc(
                        prefix,
                        currentOrganizationService.getOrganizationId()
                )
                .map(Sale::getInvoiceNo)
                .orElse(null);
        return support.nextNumber(prefix, currentNumber);
    }

    private Sale getSale(Long id) {
        return saleRepository.findByIdAndOrganizationIdAndIsDeletedFalse(id, currentOrganizationService.getOrganizationId())
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.SALE_NOT_FOUND, "SALE_NOT_FOUND"));
    }

    private void ensureNotCancelled(Sale sale) {
        if (support.isCancelled(sale.getStatus())) {
            throw new BadRequestException(ErrorMessage.SALE_ALREADY_CANCELLED, "SALE_ALREADY_CANCELLED");
        }
    }

    private boolean isPending(Sale sale) {
        return TransactionSupport.STATUS_PENDING.equals(sale.getStatus());
    }

    private Long optionalId(Long id) {
        return id == null || id <= 0 ? null : id;
    }

    private SalesCreateResponseDto toCreateResponse(Sale sale) {
        return SalesCreateResponseDto.builder()
                .saleId(sale.getId())
                .invoiceNo(sale.getInvoiceNo())
                .subTotal(sale.getSubTotal())
                .discountAmount(sale.getDiscountAmount())
                .taxAmount(sale.getTaxAmount())
                .roundOff(sale.getRoundOff())
                .grandTotal(sale.getGrandTotal())
                .paidAmount(sale.getPaidAmount())
                .dueAmount(sale.getDueAmount())
                .build();
    }

    private SalesListResponseDto toListResponse(Sale sale) {
        return SalesListResponseDto.builder()
                .saleId(sale.getId())
                .invoiceNo(sale.getInvoiceNo())
                .customerName(support.contactDisplayName(sale.getCustomer()))
                .invoiceDate(sale.getInvoiceDate())
                .grandTotal(sale.getGrandTotal())
                .paidAmount(sale.getPaidAmount())
                .dueAmount(sale.getDueAmount())
                .status(sale.getStatus())
                .build();
    }

    private SalesDetailResponseDto toDetailResponse(Sale sale) {
        return SalesDetailResponseDto.builder()
                .saleId(sale.getId())
                .invoiceNo(sale.getInvoiceNo())
                .invoiceDate(sale.getInvoiceDate())
                .customer(support.toNameId(sale.getCustomer()))
                .warehouse(support.toNameId(sale.getWarehouse()))
                .subTotal(sale.getSubTotal())
                .discountAmount(sale.getDiscountAmount())
                .taxAmount(sale.getTaxAmount())
                .grandTotal(sale.getGrandTotal())
                .paidAmount(sale.getPaidAmount())
                .dueAmount(sale.getDueAmount())
                .status(sale.getStatus())
                .notes(sale.getNotes())
                .items(salesItemRepository.findBySaleIdAndOrganizationId(
                                sale.getId(),
                                currentOrganizationService.getOrganizationId()
                        ).stream()
                        .map(this::toItemResponse)
                        .toList())
                .build();
    }

    private SalesItemResponseDto toItemResponse(SalesItem salesItem) {
        Item item = salesItem.getItem();
        ItemBatch batch = salesItem.getBatch();
        return SalesItemResponseDto.builder()
                .itemId(item == null ? null : item.getId())
                .itemName(item == null ? null : item.getItemName())
                .batchId(batch == null ? null : batch.getId())
                .batchNo(batch == null ? null : batch.getBatchNo())
                .qty(salesItem.getQty())
                .unitPrice(salesItem.getUnitPrice())
                .discountAmount(salesItem.getDiscountAmount())
                .taxAmount(salesItem.getTaxAmount())
                .totalAmount(salesItem.getTotalAmount())
                .build();
    }

    private record PreparedSale(Sale sale, List<PreparedSalesItem> items) {
    }

    private record PreparedSalesItem(
            Item item,
            List<BatchAllocation> allocations,
            SalesItemRequestDto request
    ) {
    }

    private record BatchAllocation(ItemBatch batch, BigDecimal qty) {
    }
}


