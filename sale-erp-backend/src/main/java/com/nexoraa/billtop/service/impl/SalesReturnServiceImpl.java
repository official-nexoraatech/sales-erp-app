package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.returning.ReturnDetailResponseDto;
import com.nexoraa.billtop.dto.returning.ReturnItemRequestDto;
import com.nexoraa.billtop.dto.returning.ReturnItemResponseDto;
import com.nexoraa.billtop.dto.returning.ReturnListResponseDto;
import com.nexoraa.billtop.dto.sales.SalesReturnCreateResponseDto;
import com.nexoraa.billtop.dto.sales.SalesReturnRequestDto;
import com.nexoraa.billtop.entity.Contact;
import com.nexoraa.billtop.entity.Item;
import com.nexoraa.billtop.entity.ItemBatch;
import com.nexoraa.billtop.entity.Sale;
import com.nexoraa.billtop.entity.SalesReturn;
import com.nexoraa.billtop.entity.SalesReturnItem;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.repository.SaleRepository;
import com.nexoraa.billtop.repository.SalesReturnItemRepository;
import com.nexoraa.billtop.repository.SalesReturnRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.SalesReturnService;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

@Service
public class SalesReturnServiceImpl implements SalesReturnService {

    private static final String RETURN_PREFIX = "SR-";
    private static final String TX_SALES_RETURN = "SALES_RETURN";

    private final SalesReturnRepository salesReturnRepository;
    private final SalesReturnItemRepository salesReturnItemRepository;
    private final SaleRepository saleRepository;
    private final TransactionSupport support;
    private final CurrentOrganizationService currentOrganizationService;

    public SalesReturnServiceImpl(
            SalesReturnRepository salesReturnRepository,
            SalesReturnItemRepository salesReturnItemRepository,
            SaleRepository saleRepository,
            TransactionSupport support,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.salesReturnRepository = salesReturnRepository;
        this.salesReturnItemRepository = salesReturnItemRepository;
        this.saleRepository = saleRepository;
        this.support = support;
        this.currentOrganizationService = currentOrganizationService;
    }

    @Override
    @Transactional
    public SalesReturnCreateResponseDto createSalesReturn(SalesReturnRequestDto request) {
        Sale sale = getSale(request.getSaleId());
        if (support.isCancelled(sale.getStatus())) {
            throw new BadRequestException(ErrorMessage.SALE_ALREADY_CANCELLED, "SALE_ALREADY_CANCELLED");
        }

        Contact customer = support.getActiveCustomer(request.getCustomerId());
        if (sale.getCustomer() != null && !sale.getCustomer().getId().equals(customer.getId())) {
            throw new BadRequestException("Customer does not match sale", "CUSTOMER_SALE_MISMATCH");
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

        SalesReturn salesReturn = SalesReturn.builder()
                .organization(currentOrganizationService.getOrganizationReference())
                .returnNo(nextReturnNo())
                .sale(sale)
                .customer(customer)
                .returnDate(request.getReturnDate())
                .subTotal(support.money(grandTotal))
                .discountAmount(TransactionSupport.ZERO)
                .taxAmount(TransactionSupport.ZERO)
                .grandTotal(support.money(grandTotal))
                .notes(request.getReason())
                .build();
        SalesReturn savedReturn = salesReturnRepository.save(salesReturn);
        for (PreparedReturnItem item : items) {
            salesReturnItemRepository.save(SalesReturnItem.builder()
                    .organization(currentOrganizationService.getOrganizationReference())
                    .salesReturn(savedReturn)
                    .item(item.item())
                    .batch(item.batch())
                    .qty(support.quantity(item.request().getQuantity()))
                    .rate(support.money(item.request().getRate()))
                    .amount(item.amount())
                    .build());
            support.increaseStock(
                    item.item(),
                    sale.getWarehouse(),
                    item.batch(),
                    item.request().getQuantity(),
                    TX_SALES_RETURN,
                    savedReturn.getId(),
                    "Sales return " + savedReturn.getReturnNo()
            );
        }

        return SalesReturnCreateResponseDto.builder()
                .returnId(savedReturn.getId())
                .returnNo(savedReturn.getReturnNo())
                .grandTotal(savedReturn.getGrandTotal())
                .build();
    }

    @Override
    @Transactional(readOnly = true)
    public PageResponseDto<ReturnListResponseDto> getSalesReturns(int page, int size) {
        Page<SalesReturn> returns = salesReturnRepository.findByOrganizationId(
                currentOrganizationService.getOrganizationId(),
                PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "id"))
        );
        return PageResponseDto.from(returns.map(this::toListResponse));
    }

    @Override
    @Transactional(readOnly = true)
    public ReturnDetailResponseDto getSalesReturnById(Long id) {
        SalesReturn salesReturn = salesReturnRepository.findByIdAndOrganizationId(id, currentOrganizationService.getOrganizationId())
                .orElseThrow(() -> new ResourceNotFoundException(
                        ErrorMessage.SALES_RETURN_NOT_FOUND,
                        "SALES_RETURN_NOT_FOUND"
                ));
        return ReturnDetailResponseDto.builder()
                .returnId(salesReturn.getId())
                .returnNo(salesReturn.getReturnNo())
                .returnDate(salesReturn.getReturnDate())
                .party(support.toNameId(salesReturn.getCustomer()))
                .reason(salesReturn.getNotes())
                .subTotal(salesReturn.getSubTotal())
                .discountAmount(salesReturn.getDiscountAmount())
                .taxAmount(salesReturn.getTaxAmount())
                .grandTotal(salesReturn.getGrandTotal())
                .items(salesReturnItemRepository.findBySalesReturnIdAndOrganizationId(
                                id,
                                currentOrganizationService.getOrganizationId()
                        ).stream()
                        .map(this::toItemResponse)
                        .toList())
                .build();
    }

    private Sale getSale(Long id) {
        return saleRepository.findByIdAndOrganizationId(id, currentOrganizationService.getOrganizationId())
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.SALE_NOT_FOUND, "SALE_NOT_FOUND"));
    }

    private String nextReturnNo() {
        String currentNumber = salesReturnRepository.findTopByOrganizationIdOrderByIdDesc(
                        currentOrganizationService.getOrganizationId()
                )
                .map(SalesReturn::getReturnNo)
                .orElse(null);
        return support.nextNumber(RETURN_PREFIX, currentNumber);
    }

    private ReturnListResponseDto toListResponse(SalesReturn salesReturn) {
        return ReturnListResponseDto.builder()
                .returnId(salesReturn.getId())
                .returnNo(salesReturn.getReturnNo())
                .partyName(support.contactDisplayName(salesReturn.getCustomer()))
                .returnDate(salesReturn.getReturnDate())
                .grandTotal(salesReturn.getGrandTotal())
                .build();
    }

    private ReturnItemResponseDto toItemResponse(SalesReturnItem salesReturnItem) {
        Item item = salesReturnItem.getItem();
        ItemBatch batch = salesReturnItem.getBatch();
        return ReturnItemResponseDto.builder()
                .itemId(item == null ? null : item.getId())
                .itemName(item == null ? null : item.getItemName())
                .batchId(batch == null ? null : batch.getId())
                .batchNo(batch == null ? null : batch.getBatchNo())
                .quantity(salesReturnItem.getQty())
                .rate(salesReturnItem.getRate())
                .amount(salesReturnItem.getAmount())
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
