package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.quotation.QuotationConvertRequestDto;
import com.nexoraa.billtop.dto.quotation.QuotationCreateResponseDto;
import com.nexoraa.billtop.dto.quotation.QuotationDetailResponseDto;
import com.nexoraa.billtop.dto.quotation.QuotationItemRequestDto;
import com.nexoraa.billtop.dto.quotation.QuotationItemResponseDto;
import com.nexoraa.billtop.dto.quotation.QuotationListResponseDto;
import com.nexoraa.billtop.dto.quotation.QuotationRequestDto;
import com.nexoraa.billtop.dto.sales.SalesCreateResponseDto;
import com.nexoraa.billtop.dto.sales.SalesItemRequestDto;
import com.nexoraa.billtop.dto.sales.SalesRequestDto;
import com.nexoraa.billtop.entity.Item;
import com.nexoraa.billtop.entity.Organization;
import com.nexoraa.billtop.entity.Quotation;
import com.nexoraa.billtop.entity.QuotationItem;
import com.nexoraa.billtop.entity.Sale;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.repository.QuotationItemRepository;
import com.nexoraa.billtop.repository.QuotationRepository;
import com.nexoraa.billtop.repository.SaleRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.QuotationService;
import com.nexoraa.billtop.service.SalesService;
import com.nexoraa.billtop.specification.QuotationSpecification;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

@Service
public class QuotationServiceImpl implements QuotationService {

    private static final String PREFIX = "QTN-";
    private static final String STATUS_PENDING = "PENDING";
    private static final String STATUS_REJECTED = "REJECTED";
    private static final String STATUS_CONVERTED = "CONVERTED";
    private static final String STATUS_CANCELLED = "CANCELLED";

    private final QuotationRepository quotationRepository;
    private final QuotationItemRepository quotationItemRepository;
    private final SaleRepository saleRepository;
    private final SalesService salesService;
    private final TransactionSupport support;
    private final CurrentOrganizationService currentOrganizationService;

    public QuotationServiceImpl(
            QuotationRepository quotationRepository,
            QuotationItemRepository quotationItemRepository,
            SaleRepository saleRepository,
            SalesService salesService,
            TransactionSupport support,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.quotationRepository = quotationRepository;
        this.quotationItemRepository = quotationItemRepository;
        this.saleRepository = saleRepository;
        this.salesService = salesService;
        this.support = support;
        this.currentOrganizationService = currentOrganizationService;
    }

    @Override
    @Transactional
    public QuotationCreateResponseDto createQuotation(QuotationRequestDto request) {
        Organization organization = currentOrganizationService.getOrganizationReference();
        PreparedQuotation preparedQuotation = prepareQuotation(new Quotation(), request, nextQuotationNo(), organization);
        Quotation savedQuotation = quotationRepository.save(preparedQuotation.quotation());
        saveItems(savedQuotation, preparedQuotation.items(), organization);
        return toCreateResponse(savedQuotation);
    }

    @Override
    @Transactional(readOnly = true)
    public PageResponseDto<QuotationListResponseDto> getQuotations(
            int page,
            int size,
            String search,
            Long customerId,
            String status,
            LocalDate fromDate,
            LocalDate toDate
    ) {
        Specification<Quotation> specification = QuotationSpecification.active()
                .and(QuotationSpecification.organization(currentOrganizationService.getOrganizationId()))
                .and(QuotationSpecification.search(search))
                .and(QuotationSpecification.customer(customerId))
                .and(QuotationSpecification.status(status))
                .and(QuotationSpecification.dateBetween(fromDate, toDate));
        Page<Quotation> quotations = quotationRepository.findAll(
                specification,
                PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "id"))
        );
        return PageResponseDto.from(quotations.map(this::toListResponse));
    }

    @Override
    @Transactional(readOnly = true)
    public QuotationDetailResponseDto getQuotationById(Long id) {
        return toDetailResponse(getQuotation(id));
    }

    @Override
    @Transactional
    public void updateQuotation(Long id, QuotationRequestDto request) {
        Quotation quotation = getQuotation(id);
        ensureEditable(quotation);
        Organization organization = currentOrganizationService.getOrganizationReference();
        PreparedQuotation preparedQuotation = prepareQuotation(quotation, request, quotation.getQuotationNo(), organization);
        Quotation savedQuotation = quotationRepository.save(preparedQuotation.quotation());
        quotationItemRepository.deleteByQuotationIdAndOrganizationId(
                savedQuotation.getId(),
                currentOrganizationService.getOrganizationId()
        );
        saveItems(savedQuotation, preparedQuotation.items(), organization);
    }

    @Override
    @Transactional
    public void deleteQuotation(Long id) {
        Quotation quotation = getQuotation(id);
        ensureEditable(quotation);
        quotation.setIsDeleted(true);
        quotationRepository.save(quotation);
    }

    @Override
    @Transactional
    public SalesCreateResponseDto convertToInvoice(Long id, QuotationConvertRequestDto request) {
        Quotation quotation = getQuotation(id);
        ensureConvertible(quotation);
        List<QuotationItem> items = quotationItems(quotation.getId());
        SalesCreateResponseDto invoice = salesService.createSale(SalesRequestDto.builder()
                .customerId(quotation.getCustomer() == null ? null : quotation.getCustomer().getId())
                .invoiceDate(request != null && request.getInvoiceDate() != null ? request.getInvoiceDate() : LocalDate.now())
                .warehouseId(quotation.getWarehouse() == null ? null : quotation.getWarehouse().getId())
                .stateId(quotation.getState() == null ? null : quotation.getState().getId())
                .salesPersonId(quotation.getSalesPerson() == null ? null : quotation.getSalesPerson().getId())
                .roundOff(quotation.getRoundOff())
                .notes(quotation.getNotes())
                .items(items.stream().map(this::toSalesItemRequest).toList())
                .build());
        Sale sale = saleRepository.getReferenceById(invoice.getSaleId());
        quotation.setConvertedSale(sale);
        quotation.setStatus(STATUS_CONVERTED);
        quotationRepository.save(quotation);
        return invoice;
    }

    private PreparedQuotation prepareQuotation(
            Quotation quotation,
            QuotationRequestDto request,
            String quotationNo,
            Organization organization
    ) {
        validateDates(request);
        List<PreparedQuotationItem> items = new ArrayList<>();
        BigDecimal subTotal = TransactionSupport.ZERO;
        BigDecimal discountAmount = TransactionSupport.ZERO;
        BigDecimal taxAmount = TransactionSupport.ZERO;
        BigDecimal grandTotal = TransactionSupport.ZERO;

        for (QuotationItemRequestDto itemRequest : request.getItems()) {
            Item item = support.getActiveItem(itemRequest.getItemId());
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
            items.add(new PreparedQuotationItem(item, itemRequest, lineTotals));
        }

        BigDecimal roundOff = support.money(request.getRoundOff());
        quotation.setOrganization(organization);
        quotation.setQuotationNo(quotationNo);
        quotation.setQuotationDate(request.getQuotationDate());
        quotation.setValidUntil(request.getValidUntil());
        quotation.setCustomer(support.getActiveCustomer(request.getCustomerId()));
        quotation.setWarehouse(support.getActiveWarehouse(request.getWarehouseId()));
        quotation.setState(support.getActiveState(optionalId(request.getStateId())));
        quotation.setSalesPerson(support.getActiveUser(optionalId(request.getSalesPersonId())));
        quotation.setSubTotal(support.money(subTotal));
        quotation.setDiscountAmount(support.money(discountAmount));
        quotation.setTaxAmount(support.money(taxAmount));
        quotation.setRoundOff(roundOff);
        quotation.setGrandTotal(support.money(grandTotal.add(roundOff)));
        quotation.setStatus(normalizeStatus(request.getStatus()));
        quotation.setNotes(request.getNotes());
        return new PreparedQuotation(quotation, items);
    }

    private void saveItems(
            Quotation quotation,
            List<PreparedQuotationItem> items,
            Organization organization
    ) {
        for (PreparedQuotationItem preparedItem : items) {
            quotationItemRepository.save(QuotationItem.builder()
                    .organization(organization)
                    .quotation(quotation)
                    .item(preparedItem.item())
                    .qty(support.quantity(preparedItem.request().getQuantity()))
                    .unitPrice(support.money(preparedItem.request().getUnitPrice()))
                    .discountPercent(support.defaultZero(preparedItem.request().getDiscountPercent()))
                    .discountAmount(preparedItem.totals().discountAmount())
                    .taxPercent(support.defaultZero(preparedItem.request().getTaxPercent()))
                    .taxAmount(preparedItem.totals().taxAmount())
                    .totalAmount(preparedItem.totals().totalAmount())
                    .build());
        }
    }

    private Quotation getQuotation(Long id) {
        return quotationRepository.findByIdAndOrganizationIdAndIsDeletedFalse(
                        id,
                        currentOrganizationService.getOrganizationId()
                )
                .orElseThrow(() -> new ResourceNotFoundException("Quotation not found", "QUOTATION_NOT_FOUND"));
    }

    private List<QuotationItem> quotationItems(Long quotationId) {
        return quotationItemRepository.findByQuotationIdAndOrganizationIdAndIsDeletedFalse(
                quotationId,
                currentOrganizationService.getOrganizationId()
        );
    }

    private String nextQuotationNo() {
        String currentNumber = quotationRepository.findTopByQuotationNoStartingWithAndOrganizationIdOrderByIdDesc(
                        PREFIX,
                        currentOrganizationService.getOrganizationId()
                )
                .map(Quotation::getQuotationNo)
                .orElse(null);
        return support.nextNumber(PREFIX, currentNumber);
    }

    private void validateDates(QuotationRequestDto request) {
        if (request.getQuotationDate() != null
                && request.getValidUntil() != null
                && request.getValidUntil().isBefore(request.getQuotationDate())) {
            throw new BadRequestException("Quotation valid until date cannot be before quotation date", "INVALID_QUOTATION_DATE");
        }
    }

    private void ensureEditable(Quotation quotation) {
        if (STATUS_CONVERTED.equalsIgnoreCase(quotation.getStatus())) {
            throw new BadRequestException("Quotation is already converted to invoice", "QUOTATION_ALREADY_CONVERTED");
        }
    }

    private void ensureConvertible(Quotation quotation) {
        if (STATUS_CONVERTED.equalsIgnoreCase(quotation.getStatus())) {
            throw new BadRequestException("Quotation is already converted to invoice", "QUOTATION_ALREADY_CONVERTED");
        }
        if (STATUS_CANCELLED.equalsIgnoreCase(quotation.getStatus()) || STATUS_REJECTED.equalsIgnoreCase(quotation.getStatus())) {
            throw new BadRequestException("Quotation cannot be converted in its current status", "QUOTATION_NOT_CONVERTIBLE");
        }
    }

    private String normalizeStatus(String status) {
        return StringUtils.hasText(status) ? status.trim().toUpperCase() : STATUS_PENDING;
    }

    private Long optionalId(Long id) {
        return id == null || id <= 0 ? null : id;
    }

    private SalesItemRequestDto toSalesItemRequest(QuotationItem item) {
        return SalesItemRequestDto.builder()
                .itemId(item.getItem() == null ? null : item.getItem().getId())
                .quantity(item.getQty())
                .unitPrice(item.getUnitPrice())
                .discountPercent(item.getDiscountPercent())
                .taxPercent(item.getTaxPercent())
                .build();
    }

    private QuotationCreateResponseDto toCreateResponse(Quotation quotation) {
        return QuotationCreateResponseDto.builder()
                .quotationId(quotation.getId())
                .quotationNo(quotation.getQuotationNo())
                .subTotal(quotation.getSubTotal())
                .discountAmount(quotation.getDiscountAmount())
                .taxAmount(quotation.getTaxAmount())
                .roundOff(quotation.getRoundOff())
                .grandTotal(quotation.getGrandTotal())
                .status(quotation.getStatus())
                .build();
    }

    private QuotationListResponseDto toListResponse(Quotation quotation) {
        Sale convertedSale = quotation.getConvertedSale();
        return QuotationListResponseDto.builder()
                .quotationId(quotation.getId())
                .quotationNo(quotation.getQuotationNo())
                .quotationDate(quotation.getQuotationDate())
                .validUntil(quotation.getValidUntil())
                .customerName(support.contactDisplayName(quotation.getCustomer()))
                .grandTotal(quotation.getGrandTotal())
                .status(quotation.getStatus())
                .convertedSaleId(convertedSale == null ? null : convertedSale.getId())
                .convertedInvoiceNo(convertedSale == null ? null : convertedSale.getInvoiceNo())
                .build();
    }

    private QuotationDetailResponseDto toDetailResponse(Quotation quotation) {
        Sale convertedSale = quotation.getConvertedSale();
        return QuotationDetailResponseDto.builder()
                .quotationId(quotation.getId())
                .quotationNo(quotation.getQuotationNo())
                .quotationDate(quotation.getQuotationDate())
                .validUntil(quotation.getValidUntil())
                .customer(support.toNameId(quotation.getCustomer()))
                .warehouse(support.toNameId(quotation.getWarehouse()))
                .stateId(quotation.getState() == null ? null : quotation.getState().getId())
                .salesPersonId(quotation.getSalesPerson() == null ? null : quotation.getSalesPerson().getId())
                .subTotal(quotation.getSubTotal())
                .discountAmount(quotation.getDiscountAmount())
                .taxAmount(quotation.getTaxAmount())
                .roundOff(quotation.getRoundOff())
                .grandTotal(quotation.getGrandTotal())
                .status(quotation.getStatus())
                .notes(quotation.getNotes())
                .convertedSaleId(convertedSale == null ? null : convertedSale.getId())
                .convertedInvoiceNo(convertedSale == null ? null : convertedSale.getInvoiceNo())
                .items(quotationItems(quotation.getId()).stream().map(this::toItemResponse).toList())
                .build();
    }

    private QuotationItemResponseDto toItemResponse(QuotationItem quotationItem) {
        Item item = quotationItem.getItem();
        return QuotationItemResponseDto.builder()
                .itemId(item == null ? null : item.getId())
                .itemName(item == null ? null : item.getItemName())
                .qty(quotationItem.getQty())
                .unitPrice(quotationItem.getUnitPrice())
                .discountPercent(quotationItem.getDiscountPercent())
                .discountAmount(quotationItem.getDiscountAmount())
                .taxPercent(quotationItem.getTaxPercent())
                .taxAmount(quotationItem.getTaxAmount())
                .totalAmount(quotationItem.getTotalAmount())
                .build();
    }

    private record PreparedQuotation(Quotation quotation, List<PreparedQuotationItem> items) {
    }

    private record PreparedQuotationItem(
            Item item,
            QuotationItemRequestDto request,
            TransactionSupport.LineTotals totals
    ) {
    }
}
