package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.dto.ledger.LedgerResponseDto;
import com.nexoraa.billtop.dto.purchase.PurchaseListResponseDto;
import com.nexoraa.billtop.dto.report.DayBookEntryResponseDto;
import com.nexoraa.billtop.dto.report.GstReportResponseDto;
import com.nexoraa.billtop.dto.report.InventoryValuationResponseDto;
import com.nexoraa.billtop.dto.report.ProfitLossReportResponseDto;
import com.nexoraa.billtop.dto.report.StockReportResponseDto;
import com.nexoraa.billtop.dto.report.SummaryReportResponseDto;
import com.nexoraa.billtop.dto.report.TopSellingItemResponseDto;
import com.nexoraa.billtop.dto.sales.SalesListResponseDto;
import com.nexoraa.billtop.entity.BankTransaction;
import com.nexoraa.billtop.entity.CashTransaction;
import com.nexoraa.billtop.entity.Expense;
import com.nexoraa.billtop.entity.Item;
import com.nexoraa.billtop.entity.ItemBatch;
import com.nexoraa.billtop.entity.Payment;
import com.nexoraa.billtop.entity.Purchase;
import com.nexoraa.billtop.entity.Sale;
import com.nexoraa.billtop.entity.SalesItem;
import com.nexoraa.billtop.entity.Stock;
import com.nexoraa.billtop.entity.Warehouse;
import com.nexoraa.billtop.repository.BankTransactionRepository;
import com.nexoraa.billtop.repository.CashTransactionRepository;
import com.nexoraa.billtop.repository.ExpenseRepository;
import com.nexoraa.billtop.repository.ItemPriceRepository;
import com.nexoraa.billtop.repository.PaymentRepository;
import com.nexoraa.billtop.repository.PurchaseRepository;
import com.nexoraa.billtop.repository.SaleRepository;
import com.nexoraa.billtop.repository.SalesItemRepository;
import com.nexoraa.billtop.repository.StockRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.CustomerService;
import com.nexoraa.billtop.service.ReportService;
import com.nexoraa.billtop.service.SupplierService;
import com.nexoraa.billtop.specification.PurchaseSpecification;
import com.nexoraa.billtop.specification.SaleSpecification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class ReportServiceImpl implements ReportService {

    private final SaleRepository saleRepository;
    private final PurchaseRepository purchaseRepository;
    private final ExpenseRepository expenseRepository;
    private final StockRepository stockRepository;
    private final ItemPriceRepository itemPriceRepository;
    private final SalesItemRepository salesItemRepository;
    private final PaymentRepository paymentRepository;
    private final BankTransactionRepository bankTransactionRepository;
    private final CashTransactionRepository cashTransactionRepository;
    private final CustomerService customerService;
    private final SupplierService supplierService;
    private final TransactionSupport support;
    private final CurrentOrganizationService currentOrganizationService;

    public ReportServiceImpl(
            SaleRepository saleRepository,
            PurchaseRepository purchaseRepository,
            ExpenseRepository expenseRepository,
            StockRepository stockRepository,
            ItemPriceRepository itemPriceRepository,
            SalesItemRepository salesItemRepository,
            PaymentRepository paymentRepository,
            BankTransactionRepository bankTransactionRepository,
            CashTransactionRepository cashTransactionRepository,
            CustomerService customerService,
            SupplierService supplierService,
            TransactionSupport support,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.saleRepository = saleRepository;
        this.purchaseRepository = purchaseRepository;
        this.expenseRepository = expenseRepository;
        this.stockRepository = stockRepository;
        this.itemPriceRepository = itemPriceRepository;
        this.salesItemRepository = salesItemRepository;
        this.paymentRepository = paymentRepository;
        this.bankTransactionRepository = bankTransactionRepository;
        this.cashTransactionRepository = cashTransactionRepository;
        this.customerService = customerService;
        this.supplierService = supplierService;
        this.support = support;
        this.currentOrganizationService = currentOrganizationService;
    }

    @Override
    @Transactional(readOnly = true)
    public SummaryReportResponseDto<?> getSalesReport(LocalDate fromDate, LocalDate toDate) {
        List<Sale> sales = salesBetween(fromDate, toDate);
        BigDecimal totalSales = sales.stream()
                .map(Sale::getGrandTotal)
                .map(support::defaultZero)
                .reduce(TransactionSupport.ZERO, BigDecimal::add);
        return SummaryReportResponseDto.<SalesListResponseDto>builder()
                .totalSales(support.money(totalSales))
                .invoiceCount(sales.size())
                .records(sales.stream().map(this::toSalesRecord).toList())
                .build();
    }

    @Override
    @Transactional(readOnly = true)
    public SummaryReportResponseDto<?> getPurchaseReport(LocalDate fromDate, LocalDate toDate) {
        List<Purchase> purchases = purchasesBetween(fromDate, toDate);
        BigDecimal totalPurchase = purchases.stream()
                .map(Purchase::getGrandTotal)
                .map(support::defaultZero)
                .reduce(TransactionSupport.ZERO, BigDecimal::add);
        return SummaryReportResponseDto.<PurchaseListResponseDto>builder()
                .totalPurchase(support.money(totalPurchase))
                .purchaseCount(purchases.size())
                .records(purchases.stream().map(this::toPurchaseRecord).toList())
                .build();
    }

    @Override
    @Transactional(readOnly = true)
    public List<StockReportResponseDto> getStockReport() {
        return stockRepository.findByItem_Organization_Id(currentOrganizationService.getOrganizationId()).stream()
                .map(this::toStockRecord)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<StockReportResponseDto> getLowStockReport() {
        return getStockReport().stream()
                .filter(record -> support.defaultZero(record.getAvailableQty())
                        .compareTo(support.defaultZero(record.getReorderLevel())) <= 0)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public LedgerResponseDto getCustomerLedger(Long customerId) {
        return customerService.getCustomerLedger(customerId);
    }

    @Override
    @Transactional(readOnly = true)
    public LedgerResponseDto getSupplierLedger(Long supplierId) {
        return supplierService.getSupplierLedger(supplierId);
    }

    @Override
    @Transactional(readOnly = true)
    public ProfitLossReportResponseDto getProfitLoss(LocalDate fromDate, LocalDate toDate) {
        BigDecimal totalSales = sumSales(fromDate, toDate);
        BigDecimal totalPurchase = sumPurchases(fromDate, toDate);
        BigDecimal totalExpense = sumExpenses(fromDate, toDate);
        BigDecimal grossProfit = totalSales.subtract(totalPurchase);
        return ProfitLossReportResponseDto.builder()
                .totalSales(support.money(totalSales))
                .totalPurchase(support.money(totalPurchase))
                .totalExpense(support.money(totalExpense))
                .grossProfit(support.money(grossProfit))
                .netProfit(support.money(grossProfit.subtract(totalExpense)))
                .build();
    }

    @Override
    @Transactional(readOnly = true)
    public GstReportResponseDto getGstReport(LocalDate fromDate, LocalDate toDate) {
        BigDecimal taxableAmount = TransactionSupport.ZERO;
        BigDecimal totalTax = TransactionSupport.ZERO;
        for (Sale sale : salesBetween(fromDate, toDate)) {
            taxableAmount = taxableAmount.add(support.defaultZero(sale.getSubTotal()))
                    .subtract(support.defaultZero(sale.getDiscountAmount()));
            totalTax = totalTax.add(support.defaultZero(sale.getTaxAmount()));
        }
        BigDecimal halfTax = totalTax.divide(BigDecimal.valueOf(2), 2, RoundingMode.HALF_UP);
        return GstReportResponseDto.builder()
                .taxableAmount(support.money(taxableAmount))
                .cgst(halfTax)
                .sgst(halfTax)
                .igst(TransactionSupport.ZERO)
                .totalTax(support.money(totalTax))
                .build();
    }

    @Override
    @Transactional(readOnly = true)
    public InventoryValuationResponseDto getInventoryValuation() {
        List<StockReportResponseDto> records = getStockReport();
        BigDecimal totalValue = records.stream()
                .map(StockReportResponseDto::getStockValue)
                .map(support::defaultZero)
                .reduce(TransactionSupport.ZERO, BigDecimal::add);
        return InventoryValuationResponseDto.builder()
                .totalStockValue(support.money(totalValue))
                .records(records)
                .build();
    }

    @Override
    @Transactional(readOnly = true)
    public List<TopSellingItemResponseDto> getTopSellingItems(LocalDate fromDate, LocalDate toDate) {
        Map<Long, TopSellingAccumulator> accumulators = new LinkedHashMap<>();
        for (SalesItem salesItem : salesItemRepository.findByOrganizationId(currentOrganizationService.getOrganizationId())) {
            Sale sale = salesItem.getSale();
            if (sale == null
                    || Boolean.TRUE.equals(sale.getIsDeleted())
                    || support.isCancelled(sale.getStatus())
                    || !isDateInRange(sale.getInvoiceDate(), fromDate, toDate)) {
                continue;
            }
            Item item = salesItem.getItem();
            if (item == null) {
                continue;
            }
            TopSellingAccumulator accumulator = accumulators.computeIfAbsent(
                    item.getId(),
                    id -> new TopSellingAccumulator(item.getId(), item.getItemName())
            );
            accumulator.quantity = accumulator.quantity.add(support.defaultZero(salesItem.getQty()));
            accumulator.totalAmount = accumulator.totalAmount.add(support.defaultZero(salesItem.getTotalAmount()));
        }
        return accumulators.values().stream()
                .sorted(Comparator.comparing((TopSellingAccumulator accumulator) -> accumulator.quantity).reversed())
                .map(accumulator -> TopSellingItemResponseDto.builder()
                        .itemId(accumulator.itemId)
                        .itemName(accumulator.itemName)
                        .quantity(support.quantity(accumulator.quantity))
                        .totalAmount(support.money(accumulator.totalAmount))
                        .build())
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<DayBookEntryResponseDto> getDayBook(LocalDate date) {
        List<DayBookEntryResponseDto> entries = new ArrayList<>();
        salesBetween(date, date).forEach(sale -> entries.add(DayBookEntryResponseDto.builder()
                .date(sale.getInvoiceDate())
                .type("SALE")
                .referenceNo(sale.getInvoiceNo())
                .debit(sale.getGrandTotal())
                .credit(TransactionSupport.ZERO)
                .build()));
        purchasesBetween(date, date).forEach(purchase -> entries.add(DayBookEntryResponseDto.builder()
                .date(purchase.getPurchaseDate())
                .type("PURCHASE")
                .referenceNo(purchase.getPurchaseNo())
                .debit(TransactionSupport.ZERO)
                .credit(purchase.getGrandTotal())
                .build()));
        paymentRepository.findByPaymentDateAndPaymentTypeInAndOrganizationId(date, List.of(
                FinanceSupport.PAYMENT_IN,
                FinanceSupport.PAYMENT_OUT,
                FinanceSupport.POS,
                FinanceSupport.EXPENSE
        ), currentOrganizationService.getOrganizationId()).forEach(payment -> entries.add(DayBookEntryResponseDto.builder()
                .date(payment.getPaymentDate())
                .type(payment.getPaymentType())
                .referenceNo(payment.getPaymentNo())
                .debit(FinanceSupport.PAYMENT_OUT.equals(payment.getPaymentType()) || FinanceSupport.EXPENSE.equals(payment.getPaymentType())
                        ? payment.getAmount() : TransactionSupport.ZERO)
                .credit(FinanceSupport.PAYMENT_IN.equals(payment.getPaymentType()) || FinanceSupport.POS.equals(payment.getPaymentType())
                        ? payment.getAmount() : TransactionSupport.ZERO)
                .build()));
        entries.sort(Comparator.comparing(DayBookEntryResponseDto::getDate));
        return entries;
    }

    private List<Sale> salesBetween(LocalDate fromDate, LocalDate toDate) {
        return saleRepository.findAll(SaleSpecification.notCancelled()
                .and(SaleSpecification.notDeleted())
                .and(SaleSpecification.organization(currentOrganizationService.getOrganizationId()))
                .and(SaleSpecification.dateBetween(fromDate, toDate)));
    }

    private List<Purchase> purchasesBetween(LocalDate fromDate, LocalDate toDate) {
        return purchaseRepository.findAll(PurchaseSpecification.notCancelled()
                .and(PurchaseSpecification.notDeleted())
                .and(PurchaseSpecification.organization(currentOrganizationService.getOrganizationId()))
                .and(PurchaseSpecification.dateBetween(fromDate, toDate)));
    }

    private boolean isDateInRange(LocalDate value, LocalDate fromDate, LocalDate toDate) {
        if (value == null) {
            return false;
        }
        if (fromDate != null && value.isBefore(fromDate)) {
            return false;
        }
        if (toDate != null && value.isAfter(toDate)) {
            return false;
        }
        return true;
    }

    private BigDecimal sumSales(LocalDate fromDate, LocalDate toDate) {
        return salesBetween(fromDate, toDate).stream()
                .map(Sale::getGrandTotal)
                .map(support::defaultZero)
                .reduce(TransactionSupport.ZERO, BigDecimal::add);
    }

    private BigDecimal sumPurchases(LocalDate fromDate, LocalDate toDate) {
        return purchasesBetween(fromDate, toDate).stream()
                .map(Purchase::getGrandTotal)
                .map(support::defaultZero)
                .reduce(TransactionSupport.ZERO, BigDecimal::add);
    }

    private BigDecimal sumExpenses(LocalDate fromDate, LocalDate toDate) {
        return expenseRepository.findByExpenseDateBetweenAndOrganizationIdOrderByExpenseDateAscIdAsc(
                        fromDate,
                        toDate,
                        currentOrganizationService.getOrganizationId()
                )
                .stream()
                .map(Expense::getAmount)
                .map(support::defaultZero)
                .reduce(TransactionSupport.ZERO, BigDecimal::add);
    }

    private SalesListResponseDto toSalesRecord(Sale sale) {
        return SalesListResponseDto.builder()
                .saleId(sale.getId())
                .invoiceNo(sale.getInvoiceNo())
                .customerName(support.contactDisplayName(sale.getCustomer()))
                .invoiceDate(sale.getInvoiceDate())
                .grandTotal(sale.getGrandTotal())
                .paidAmount(sale.getPaidAmount())
                .dueAmount(sale.getDueAmount())
                .build();
    }

    private PurchaseListResponseDto toPurchaseRecord(Purchase purchase) {
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

    private StockReportResponseDto toStockRecord(Stock stock) {
        Item item = stock.getItem();
        Warehouse warehouse = stock.getWarehouse();
        ItemBatch batch = stock.getBatch();
        BigDecimal availableQty = support.defaultZero(stock.getAvailableQty());
        BigDecimal stockValue = availableQty.multiply(itemPurchasePrice(item == null ? null : item.getId()));
        return StockReportResponseDto.builder()
                .itemId(item == null ? null : item.getId())
                .itemName(item == null ? null : item.getItemName())
                .warehouseId(warehouse == null ? null : warehouse.getId())
                .warehouseName(warehouse == null ? null : warehouse.getName())
                .batchId(batch == null ? null : batch.getId())
                .batchNo(batch == null ? null : batch.getBatchNo())
                .availableQty(stock.getAvailableQty())
                .reorderLevel(stock.getReorderLevel())
                .stockValue(support.money(stockValue))
                .build();
    }

    private BigDecimal itemPurchasePrice(Long itemId) {
        if (itemId == null) {
            return TransactionSupport.ZERO;
        }
        return itemPriceRepository.findTopByItemIdOrderByIdDesc(itemId)
                .map(price -> support.defaultZero(price.getPurchasePrice()))
                .orElse(TransactionSupport.ZERO);
    }

    private static class TopSellingAccumulator {
        private final Long itemId;
        private final String itemName;
        private BigDecimal quantity = TransactionSupport.ZERO;
        private BigDecimal totalAmount = TransactionSupport.ZERO;

        private TopSellingAccumulator(Long itemId, String itemName) {
            this.itemId = itemId;
            this.itemName = itemName;
        }
    }
}
