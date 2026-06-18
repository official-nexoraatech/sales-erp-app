package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.pos.PosBillingItemRequestDto;
import com.nexoraa.billtop.dto.pos.PosBillingRequestDto;
import com.nexoraa.billtop.dto.pos.PosBillingResponseDto;
import com.nexoraa.billtop.entity.Contact;
import com.nexoraa.billtop.entity.Item;
import com.nexoraa.billtop.entity.Payment;
import com.nexoraa.billtop.entity.PaymentMethod;
import com.nexoraa.billtop.entity.Sale;
import com.nexoraa.billtop.entity.SalesItem;
import com.nexoraa.billtop.entity.SalesPayment;
import com.nexoraa.billtop.entity.Stock;
import com.nexoraa.billtop.entity.Warehouse;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.repository.PaymentRepository;
import com.nexoraa.billtop.repository.SaleRepository;
import com.nexoraa.billtop.repository.SalesItemRepository;
import com.nexoraa.billtop.repository.SalesPaymentRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.PosBillingService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

@Service
public class PosBillingServiceImpl implements PosBillingService {

    private static final String POS_PREFIX = "POS-";
    private static final String PAYMENT_PREFIX = "PAY-";
    private static final String PAYMENT_TYPE = "POS";
    private static final String TX_POS_SALE = "POS_SALE";
    private static final String SYSTEM = "SYSTEM";

    private final SaleRepository saleRepository;
    private final SalesItemRepository salesItemRepository;
    private final PaymentRepository paymentRepository;
    private final SalesPaymentRepository salesPaymentRepository;
    private final TransactionSupport support;
    private final CurrentOrganizationService currentOrganizationService;

    public PosBillingServiceImpl(
            SaleRepository saleRepository,
            SalesItemRepository salesItemRepository,
            PaymentRepository paymentRepository,
            SalesPaymentRepository salesPaymentRepository,
            TransactionSupport support,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.saleRepository = saleRepository;
        this.salesItemRepository = salesItemRepository;
        this.paymentRepository = paymentRepository;
        this.salesPaymentRepository = salesPaymentRepository;
        this.support = support;
        this.currentOrganizationService = currentOrganizationService;
    }

    @Override
    @Transactional
    public PosBillingResponseDto createBill(PosBillingRequestDto request) {
        Contact customer = support.getActiveCustomer(request.getCustomerId());
        Warehouse warehouse = support.getActiveWarehouse(request.getWarehouseId());
        PaymentMethod paymentMethod = support.getActivePaymentMethod(request.getPaymentMethodId());

        List<PreparedPosItem> items = new ArrayList<>();
        BigDecimal grandTotal = TransactionSupport.ZERO;
        for (PosBillingItemRequestDto itemRequest : request.getItems()) {
            Item item = support.getActiveItem(itemRequest.getItemId());
            BigDecimal unitPrice = support.getSalePrice(item);
            BigDecimal amount = support.amount(itemRequest.getQuantity(), unitPrice);
            grandTotal = grandTotal.add(amount);
            items.add(new PreparedPosItem(item, itemRequest.getQuantity(), unitPrice));
        }
        grandTotal = support.money(grandTotal);

        Sale sale = Sale.builder()
                .organization(currentOrganizationService.getOrganizationReference())
                .invoiceNo(nextNumber(POS_PREFIX))
                .invoiceDate(LocalDate.now())
                .customer(customer)
                .warehouse(warehouse)
                .subTotal(grandTotal)
                .discountAmount(TransactionSupport.ZERO)
                .taxAmount(TransactionSupport.ZERO)
                .roundOff(TransactionSupport.ZERO)
                .grandTotal(grandTotal)
                .paidAmount(grandTotal)
                .dueAmount(TransactionSupport.ZERO)
                .status(TransactionSupport.STATUS_PAID)
                .notes("POS billing")
                .build();
        Sale savedSale = saleRepository.save(sale);

        for (PreparedPosItem item : items) {
            allocateStockAndCreateSaleItems(savedSale, warehouse, item);
        }

        Payment payment = paymentRepository.save(Payment.builder()
                .organization(currentOrganizationService.getOrganizationReference())
                .paymentNo(nextPaymentNo())
                .paymentType(PAYMENT_TYPE)
                .paymentMethod(paymentMethod)
                .contact(customer)
                .amount(grandTotal)
                .paymentDate(LocalDate.now())
                .referenceNo(savedSale.getInvoiceNo())
                .notes("POS bill " + savedSale.getInvoiceNo())
                .build());
        salesPaymentRepository.save(SalesPayment.builder()
                .organization(currentOrganizationService.getOrganizationReference())
                .sale(savedSale)
                .payment(payment)
                .amount(grandTotal)
                .build());

        return PosBillingResponseDto.builder()
                .invoiceNo(savedSale.getInvoiceNo())
                .grandTotal(savedSale.getGrandTotal())
                .paymentStatus(savedSale.getStatus())
                .build();
    }

    private void allocateStockAndCreateSaleItems(Sale sale, Warehouse warehouse, PreparedPosItem item) {
        BigDecimal remainingQty = item.quantity();
        for (Stock stock : support.getStocksForItemAndWarehouse(item.item().getId(), warehouse.getId())) {
            if (remainingQty.compareTo(TransactionSupport.ZERO) <= 0) {
                break;
            }
            BigDecimal availableQty = support.defaultZero(stock.getAvailableQty());
            if (availableQty.compareTo(TransactionSupport.ZERO) <= 0) {
                continue;
            }
            BigDecimal allocatedQty = availableQty.min(remainingQty);
            BigDecimal lineAmount = support.amount(allocatedQty, item.unitPrice());
            salesItemRepository.save(SalesItem.builder()
                    .organization(currentOrganizationService.getOrganizationReference())
                    .sale(sale)
                    .item(item.item())
                    .batch(stock.getBatch())
                    .qty(support.quantity(allocatedQty))
                    .unitPrice(item.unitPrice())
                    .discountPercent(TransactionSupport.ZERO)
                    .discountAmount(TransactionSupport.ZERO)
                    .taxPercent(TransactionSupport.ZERO)
                    .taxAmount(TransactionSupport.ZERO)
                    .totalAmount(lineAmount)
                    .build());
            support.decreaseStock(
                    item.item(),
                    warehouse,
                    stock.getBatch(),
                    allocatedQty,
                    TX_POS_SALE,
                    sale.getId(),
                    "POS bill " + sale.getInvoiceNo()
            );
            remainingQty = remainingQty.subtract(allocatedQty);
        }

        if (remainingQty.compareTo(TransactionSupport.ZERO) > 0) {
            throw new BadRequestException(ErrorMessage.INSUFFICIENT_STOCK, "INSUFFICIENT_STOCK");
        }
    }

    private String nextNumber(String prefix) {
        String currentNumber = saleRepository.findTopByInvoiceNoStartingWithAndOrganizationIdOrderByIdDesc(
                        prefix,
                        currentOrganizationService.getOrganizationId()
                )
                .map(Sale::getInvoiceNo)
                .orElse(null);
        return support.nextNumber(prefix, currentNumber);
    }

    private String nextPaymentNo() {
        String currentNumber = paymentRepository.findTopByPaymentNoStartingWithAndOrganizationIdOrderByIdDesc(
                        PAYMENT_PREFIX,
                        currentOrganizationService.getOrganizationId()
                )
                .map(Payment::getPaymentNo)
                .orElse(null);
        return support.nextNumber(PAYMENT_PREFIX, currentNumber);
    }

    private record PreparedPosItem(Item item, BigDecimal quantity, BigDecimal unitPrice) {
    }
}


