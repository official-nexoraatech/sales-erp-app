package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.dto.ledger.LedgerResponseDto;
import com.nexoraa.billtop.dto.purchase.PurchaseListResponseDto;
import com.nexoraa.billtop.dto.report.BankStatementEntryResponseDto;
import com.nexoraa.billtop.dto.report.CustomerDueResponseDto;
import com.nexoraa.billtop.dto.report.DayBookEntryResponseDto;
import com.nexoraa.billtop.dto.report.ExpenseReportResponseDto;
import com.nexoraa.billtop.dto.report.ExpiredItemResponseDto;
import com.nexoraa.billtop.dto.report.GstReportResponseDto;
import com.nexoraa.billtop.dto.report.InventoryValuationResponseDto;
import com.nexoraa.billtop.dto.report.ItemTransactionResponseDto;
import com.nexoraa.billtop.dto.report.PaymentReportResponseDto;
import com.nexoraa.billtop.dto.report.ProfitLossReportResponseDto;
import com.nexoraa.billtop.dto.report.StockReportResponseDto;
import com.nexoraa.billtop.dto.report.SummaryReportResponseDto;
import com.nexoraa.billtop.dto.report.SupplierDueResponseDto;
import com.nexoraa.billtop.dto.report.TopSellingItemResponseDto;
import com.nexoraa.billtop.dto.sales.SalesListResponseDto;
import com.nexoraa.billtop.entity.BankAccount;
import com.nexoraa.billtop.entity.BankTransaction;
import com.nexoraa.billtop.entity.Contact;
import com.nexoraa.billtop.entity.Expense;
import com.nexoraa.billtop.entity.Item;
import com.nexoraa.billtop.entity.ItemBatch;
import com.nexoraa.billtop.entity.Payment;
import com.nexoraa.billtop.entity.Purchase;
import com.nexoraa.billtop.entity.PurchasePayment;
import com.nexoraa.billtop.entity.PurchaseReturn;
import com.nexoraa.billtop.entity.Sale;
import com.nexoraa.billtop.entity.SalesItem;
import com.nexoraa.billtop.entity.SalesPayment;
import com.nexoraa.billtop.entity.SalesReturn;
import com.nexoraa.billtop.entity.Stock;
import com.nexoraa.billtop.entity.StockTransaction;
import com.nexoraa.billtop.entity.Warehouse;
import com.nexoraa.billtop.repository.BankAccountRepository;
import com.nexoraa.billtop.repository.BankTransactionRepository;
import com.nexoraa.billtop.repository.CashTransactionRepository;
import com.nexoraa.billtop.repository.ExpenseRepository;
import com.nexoraa.billtop.repository.ItemBatchRepository;
import com.nexoraa.billtop.repository.ItemPriceRepository;
import com.nexoraa.billtop.repository.PaymentRepository;
import com.nexoraa.billtop.repository.PurchasePaymentRepository;
import com.nexoraa.billtop.repository.PurchaseRepository;
import com.nexoraa.billtop.repository.PurchaseReturnRepository;
import com.nexoraa.billtop.repository.SaleRepository;
import com.nexoraa.billtop.repository.SalesItemRepository;
import com.nexoraa.billtop.repository.SalesPaymentRepository;
import com.nexoraa.billtop.repository.SalesReturnRepository;
import com.nexoraa.billtop.repository.StockRepository;
import com.nexoraa.billtop.repository.StockTransactionRepository;
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
import java.time.LocalTime;
import java.time.temporal.ChronoUnit;
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
    private final SalesReturnRepository salesReturnRepository;
    private final PurchaseReturnRepository purchaseReturnRepository;
    private final PurchasePaymentRepository purchasePaymentRepository;
    private final SalesPaymentRepository salesPaymentRepository;
    private final BankAccountRepository bankAccountRepository;
    private final StockTransactionRepository stockTransactionRepository;
    private final ItemBatchRepository itemBatchRepository;

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
            CurrentOrganizationService currentOrganizationService,
            SalesReturnRepository salesReturnRepository,
            PurchaseReturnRepository purchaseReturnRepository,
            PurchasePaymentRepository purchasePaymentRepository,
            SalesPaymentRepository salesPaymentRepository,
            BankAccountRepository bankAccountRepository,
            StockTransactionRepository stockTransactionRepository,
            ItemBatchRepository itemBatchRepository
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
        this.salesReturnRepository = salesReturnRepository;
        this.purchaseReturnRepository = purchaseReturnRepository;
        this.purchasePaymentRepository = purchasePaymentRepository;
        this.salesPaymentRepository = salesPaymentRepository;
        this.bankAccountRepository = bankAccountRepository;
        this.stockTransactionRepository = stockTransactionRepository;
        this.itemBatchRepository = itemBatchRepository;
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
        Long organizationId = currentOrganizationService.getOrganizationId();

        BigDecimal saleWithoutTax = salesBetween(fromDate, toDate).stream()
                .map(sale -> support.defaultZero(sale.getSubTotal()).subtract(support.defaultZero(sale.getDiscountAmount())))
                .reduce(TransactionSupport.ZERO, BigDecimal::add);
        BigDecimal purchaseWithoutTax = purchasesBetween(fromDate, toDate).stream()
                .map(purchase -> support.defaultZero(purchase.getSubTotal()).subtract(support.defaultZero(purchase.getDiscountAmount())))
                .reduce(TransactionSupport.ZERO, BigDecimal::add);
        BigDecimal saleReturnWithoutTax = salesReturnRepository.findByOrganizationIdAndReturnDateBetween(organizationId, fromDate, toDate).stream()
                .map(salesReturn -> support.defaultZero(salesReturn.getSubTotal()).subtract(support.defaultZero(salesReturn.getDiscountAmount())))
                .reduce(TransactionSupport.ZERO, BigDecimal::add);
        BigDecimal purchaseReturnWithoutTax = purchaseReturnRepository.findByOrganizationIdAndReturnDateBetween(organizationId, fromDate, toDate).stream()
                .map(purchaseReturn -> support.defaultZero(purchaseReturn.getSubTotal()).subtract(support.defaultZero(purchaseReturn.getDiscountAmount())))
                .reduce(TransactionSupport.ZERO, BigDecimal::add);
        BigDecimal expenseWithoutTax = sumExpenses(fromDate, toDate);
        BigDecimal shippingCharge = TransactionSupport.ZERO;

        BigDecimal grossProfit = saleWithoutTax.subtract(purchaseWithoutTax);
        BigDecimal netSummary = saleWithoutTax
                .subtract(saleReturnWithoutTax)
                .subtract(purchaseWithoutTax)
                .add(purchaseReturnWithoutTax)
                .subtract(expenseWithoutTax)
                .subtract(shippingCharge);

        return ProfitLossReportResponseDto.builder()
                .totalSales(support.money(saleWithoutTax))
                .totalPurchase(support.money(purchaseWithoutTax))
                .totalExpense(support.money(expenseWithoutTax))
                .grossProfit(support.money(grossProfit))
                .netProfit(support.money(netSummary))
                .saleWithoutTax(support.money(saleWithoutTax))
                .saleReturnWithoutTax(support.money(saleReturnWithoutTax))
                .purchaseWithoutTax(support.money(purchaseWithoutTax))
                .purchaseReturnWithoutTax(support.money(purchaseReturnWithoutTax))
                .expenseWithoutTax(support.money(expenseWithoutTax))
                .shippingCharge(support.money(shippingCharge))
                .netSummary(support.money(netSummary))
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

    @Override
    @Transactional(readOnly = true)
    public List<CustomerDueResponseDto> getCustomerDues(Long customerId) {
        Map<Long, DueAccumulator> accumulators = new LinkedHashMap<>();
        for (Sale sale : salesBetween(null, null)) {
            Contact customer = sale.getCustomer();
            if (customer == null || (customerId != null && !customerId.equals(customer.getId()))) {
                continue;
            }
            DueAccumulator accumulator = accumulators.computeIfAbsent(
                    customer.getId(), id -> new DueAccumulator(customer.getId(), support.contactDisplayName(customer)));
            accumulator.dueAmount = accumulator.dueAmount.add(support.defaultZero(sale.getDueAmount()));
        }
        return accumulators.values().stream()
                .filter(accumulator -> accumulator.dueAmount.compareTo(TransactionSupport.ZERO) > 0)
                .map(accumulator -> CustomerDueResponseDto.builder()
                        .customerId(accumulator.id)
                        .customerName(accumulator.name)
                        .dueAmount(support.money(accumulator.dueAmount))
                        .build())
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<SupplierDueResponseDto> getSupplierDues(Long supplierId) {
        Map<Long, DueAccumulator> accumulators = new LinkedHashMap<>();
        for (Purchase purchase : purchasesBetween(null, null)) {
            Contact supplier = purchase.getSupplier();
            if (supplier == null || (supplierId != null && !supplierId.equals(supplier.getId()))) {
                continue;
            }
            DueAccumulator accumulator = accumulators.computeIfAbsent(
                    supplier.getId(), id -> new DueAccumulator(supplier.getId(), support.contactDisplayName(supplier)));
            accumulator.dueAmount = accumulator.dueAmount.add(support.defaultZero(purchase.getDueAmount()));
        }
        return accumulators.values().stream()
                .filter(accumulator -> accumulator.dueAmount.compareTo(TransactionSupport.ZERO) > 0)
                .map(accumulator -> SupplierDueResponseDto.builder()
                        .supplierId(accumulator.id)
                        .supplierName(accumulator.name)
                        .dueAmount(support.money(accumulator.dueAmount))
                        .build())
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<PaymentReportResponseDto> getPurchasePayments(LocalDate fromDate, LocalDate toDate, Long supplierId, Long paymentMethodId) {
        return purchasePaymentRepository.findByOrganizationIdAndPayment_PaymentDateBetween(
                        currentOrganizationService.getOrganizationId(), fromDate, toDate)
                .stream()
                .filter(purchasePayment -> supplierId == null
                        || (purchasePayment.getPurchase() != null && purchasePayment.getPurchase().getSupplier() != null
                        && supplierId.equals(purchasePayment.getPurchase().getSupplier().getId())))
                .filter(purchasePayment -> paymentMethodId == null
                        || (purchasePayment.getPayment() != null && purchasePayment.getPayment().getPaymentMethod() != null
                        && paymentMethodId.equals(purchasePayment.getPayment().getPaymentMethod().getId())))
                .map(this::toPurchasePaymentRecord)
                .sorted(Comparator.comparing(PaymentReportResponseDto::getDate, Comparator.nullsLast(Comparator.naturalOrder())))
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<PaymentReportResponseDto> getSalePayments(LocalDate fromDate, LocalDate toDate, Long customerId, Long paymentMethodId) {
        return salesPaymentRepository.findByOrganizationIdAndPayment_PaymentDateBetween(
                        currentOrganizationService.getOrganizationId(), fromDate, toDate)
                .stream()
                .filter(salesPayment -> customerId == null
                        || (salesPayment.getSale() != null && salesPayment.getSale().getCustomer() != null
                        && customerId.equals(salesPayment.getSale().getCustomer().getId())))
                .filter(salesPayment -> paymentMethodId == null
                        || (salesPayment.getPayment() != null && salesPayment.getPayment().getPaymentMethod() != null
                        && paymentMethodId.equals(salesPayment.getPayment().getPaymentMethod().getId())))
                .map(this::toSalePaymentRecord)
                .sorted(Comparator.comparing(PaymentReportResponseDto::getDate, Comparator.nullsLast(Comparator.naturalOrder())))
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<ExpenseReportResponseDto> getExpenseReport(LocalDate fromDate, LocalDate toDate, Long categoryId, Long paymentMethodId) {
        return expenseRepository.findByExpenseDateBetweenAndOrganizationIdOrderByExpenseDateAscIdAsc(
                        fromDate, toDate, currentOrganizationService.getOrganizationId())
                .stream()
                .filter(expense -> categoryId == null
                        || (expense.getExpenseCategory() != null && categoryId.equals(expense.getExpenseCategory().getId())))
                .filter(expense -> paymentMethodId == null
                        || (expense.getPaymentMethod() != null && paymentMethodId.equals(expense.getPaymentMethod().getId())))
                .map(this::toExpenseRecord)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<BankStatementEntryResponseDto> getBankStatement(LocalDate fromDate, LocalDate toDate, Long bankAccountId) {
        Long organizationId = currentOrganizationService.getOrganizationId();
        List<BankTransaction> transactions = bankAccountId != null
                ? bankTransactionRepository.findByBankAccountIdAndOrganizationIdAndTransactionDateBetweenOrderByTransactionDateAscIdAsc(
                        bankAccountId, organizationId, fromDate, toDate)
                : bankTransactionRepository.findByOrganizationIdAndTransactionDateBetweenOrderByTransactionDateAscIdAsc(
                        organizationId, fromDate, toDate);
        BigDecimal balance = bankAccountId == null
                ? TransactionSupport.ZERO
                : bankAccountRepository.findById(bankAccountId)
                        .map(BankAccount::getOpeningBalance)
                        .map(support::defaultZero)
                        .orElse(TransactionSupport.ZERO);

        List<BankStatementEntryResponseDto> entries = new ArrayList<>();
        for (BankTransaction transaction : transactions) {
            BigDecimal amount = support.defaultZero(transaction.getAmount());
            boolean isDeposit = FinanceSupport.PAYMENT_IN.equals(transaction.getTransactionType())
                    || FinanceSupport.POS.equals(transaction.getTransactionType());
            balance = isDeposit ? balance.add(amount) : balance.subtract(amount);
            entries.add(BankStatementEntryResponseDto.builder()
                    .date(transaction.getTransactionDate())
                    .description(transaction.getRemarks())
                    .withdrawalAmount(isDeposit ? TransactionSupport.ZERO : support.money(amount))
                    .depositAmount(isDeposit ? support.money(amount) : TransactionSupport.ZERO)
                    .balance(support.money(balance))
                    .build());
        }
        return entries;
    }

    @Override
    @Transactional(readOnly = true)
    public List<ItemTransactionResponseDto> getItemTransactionsBatch(
            LocalDate fromDate, LocalDate toDate, Long itemId, Long brandId, String batchNo, Long warehouseId
    ) {
        return stockTransactionsBetween(fromDate, toDate).stream()
                .filter(transaction -> transaction.getBatch() != null)
                .filter(transaction -> matchesItemFilters(transaction, itemId, brandId, warehouseId))
                .filter(transaction -> batchNo == null
                        || batchNo.equalsIgnoreCase(transaction.getBatch().getBatchNo()))
                .map(this::toItemTransactionRecord)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<ItemTransactionResponseDto> getItemTransactionsGeneral(
            LocalDate fromDate, LocalDate toDate, Long itemId, Long brandId, Long warehouseId
    ) {
        return stockTransactionsBetween(fromDate, toDate).stream()
                .filter(transaction -> matchesItemFilters(transaction, itemId, brandId, warehouseId))
                .map(this::toItemTransactionRecord)
                .toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<ItemTransactionResponseDto> getItemTransactionsSerial(
            LocalDate fromDate, LocalDate toDate, Long itemId, Long brandId, String serialImei, Long warehouseId
    ) {
        // No serial/IMEI tracking table exists in the schema today (only batch-level tracking
        // via ItemBatch) — this endpoint responds correctly but has no data source to draw from.
        return List.of();
    }

    @Override
    @Transactional(readOnly = true)
    public List<ExpiredItemResponseDto> getExpiredItems(
            String filterType, LocalDate fromDate, LocalDate toDate, Long itemId, Long brandId, String batchNo, Long warehouseId
    ) {
        Long organizationId = currentOrganizationService.getOrganizationId();
        LocalDate today = LocalDate.now();
        List<ExpiredItemResponseDto> results = new ArrayList<>();
        for (ItemBatch batch : itemBatchRepository.findByItem_Organization_Id(organizationId)) {
            LocalDate expiryDate = batch.getExpiryDate();
            Item item = batch.getItem();
            if (expiryDate == null || item == null) {
                continue;
            }
            if (!isExpiryInScope(filterType, expiryDate, fromDate, toDate, today)) {
                continue;
            }
            if ((itemId != null && !itemId.equals(item.getId()))
                    || (brandId != null && (item.getBrand() == null || !brandId.equals(item.getBrand().getId())))
                    || (batchNo != null && !batchNo.equalsIgnoreCase(batch.getBatchNo()))) {
                continue;
            }
            for (Stock stock : stockRepository.findByItemId(item.getId())) {
                if (stock.getBatch() == null || !batch.getId().equals(stock.getBatch().getId())) {
                    continue;
                }
                Warehouse warehouse = stock.getWarehouse();
                if (warehouseId != null && (warehouse == null || !warehouseId.equals(warehouse.getId()))) {
                    continue;
                }
                results.add(ExpiredItemResponseDto.builder()
                        .warehouseId(warehouse == null ? null : warehouse.getId())
                        .warehouseName(warehouse == null ? null : warehouse.getName())
                        .itemId(item.getId())
                        .itemName(item.getItemName())
                        .brandName(item.getBrand() == null ? null : item.getBrand().getName())
                        .batchNo(batch.getBatchNo())
                        .expiryDate(expiryDate)
                        .daysUntilExpiry(ChronoUnit.DAYS.between(today, expiryDate))
                        .availableQty(support.quantity(stock.getAvailableQty()))
                        .build());
            }
        }
        return results;
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

    private List<StockTransaction> stockTransactionsBetween(LocalDate fromDate, LocalDate toDate) {
        return stockTransactionRepository.findByOrganizationIdAndTransactionDateBetweenOrderByTransactionDateAscIdAsc(
                currentOrganizationService.getOrganizationId(),
                fromDate.atStartOfDay(),
                toDate.atTime(LocalTime.MAX)
        );
    }

    private boolean matchesItemFilters(StockTransaction transaction, Long itemId, Long brandId, Long warehouseId) {
        Item item = transaction.getItem();
        if (itemId != null && (item == null || !itemId.equals(item.getId()))) {
            return false;
        }
        if (brandId != null && (item == null || item.getBrand() == null || !brandId.equals(item.getBrand().getId()))) {
            return false;
        }
        if (warehouseId != null && (transaction.getWarehouse() == null || !warehouseId.equals(transaction.getWarehouse().getId()))) {
            return false;
        }
        return true;
    }

    private boolean isExpiryInScope(String filterType, LocalDate expiryDate, LocalDate fromDate, LocalDate toDate, LocalDate today) {
        if ("expiredTillDate".equalsIgnoreCase(filterType)) {
            return toDate == null || !expiryDate.isAfter(toDate);
        }
        if ("daysRemaining".equalsIgnoreCase(filterType)) {
            return !expiryDate.isBefore(today) && (toDate == null || !expiryDate.isAfter(toDate));
        }
        if (fromDate != null && expiryDate.isBefore(fromDate)) {
            return false;
        }
        return toDate == null || !expiryDate.isAfter(toDate);
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

    private PaymentReportResponseDto toPurchasePaymentRecord(PurchasePayment purchasePayment) {
        Payment payment = purchasePayment.getPayment();
        Purchase purchase = purchasePayment.getPurchase();
        return PaymentReportResponseDto.builder()
                .date(payment == null ? null : payment.getPaymentDate())
                .referenceNo(purchase == null ? null : purchase.getPurchaseNo())
                .partyName(purchase == null ? null : support.contactDisplayName(purchase.getSupplier()))
                .paymentType(payment == null || payment.getPaymentMethod() == null ? null : payment.getPaymentMethod().getName())
                .paidAmount(support.money(purchasePayment.getAmount()))
                .build();
    }

    private PaymentReportResponseDto toSalePaymentRecord(SalesPayment salesPayment) {
        Payment payment = salesPayment.getPayment();
        Sale sale = salesPayment.getSale();
        return PaymentReportResponseDto.builder()
                .date(payment == null ? null : payment.getPaymentDate())
                .referenceNo(sale == null ? null : sale.getInvoiceNo())
                .partyName(sale == null ? null : support.contactDisplayName(sale.getCustomer()))
                .paymentType(payment == null || payment.getPaymentMethod() == null ? null : payment.getPaymentMethod().getName())
                .paidAmount(support.money(salesPayment.getAmount()))
                .build();
    }

    private ExpenseReportResponseDto toExpenseRecord(Expense expense) {
        return ExpenseReportResponseDto.builder()
                .date(expense.getExpenseDate())
                .expenseCode(expense.getExpenseNo())
                .category(expense.getExpenseCategory() == null ? null : expense.getExpenseCategory().getName())
                .paymentType(expense.getPaymentMethod() == null ? null : expense.getPaymentMethod().getName())
                .paidAmount(support.money(expense.getAmount()))
                .build();
    }

    private ItemTransactionResponseDto toItemTransactionRecord(StockTransaction transaction) {
        Item item = transaction.getItem();
        Warehouse warehouse = transaction.getWarehouse();
        ItemBatch batch = transaction.getBatch();
        BigDecimal quantity = support.defaultZero(transaction.getQtyIn()).subtract(support.defaultZero(transaction.getQtyOut()));
        return ItemTransactionResponseDto.builder()
                .date(transaction.getTransactionDate() == null ? null : transaction.getTransactionDate().toLocalDate())
                .type(transaction.getTransactionType())
                .referenceNo(resolveReferenceNo(transaction.getTransactionType(), transaction.getReferenceId()))
                .partyName(resolvePartyName(transaction.getTransactionType(), transaction.getReferenceId()))
                .warehouseName(warehouse == null ? null : warehouse.getName())
                .itemName(item == null ? null : item.getItemName())
                .brandName(item == null || item.getBrand() == null ? null : item.getBrand().getName())
                .batchNo(batch == null ? null : batch.getBatchNo())
                .quantity(support.quantity(quantity))
                .stock(support.quantity(transaction.getBalanceQty()))
                .build();
    }

    private String resolveReferenceNo(String transactionType, Long referenceId) {
        if (referenceId == null) {
            return null;
        }
        if ("SALE".equals(transactionType)) {
            return saleRepository.findById(referenceId).map(Sale::getInvoiceNo).orElse(null);
        }
        if ("PURCHASE".equals(transactionType)) {
            return purchaseRepository.findById(referenceId).map(Purchase::getPurchaseNo).orElse(null);
        }
        return "#" + referenceId;
    }

    private String resolvePartyName(String transactionType, Long referenceId) {
        if (referenceId == null) {
            return null;
        }
        if ("SALE".equals(transactionType)) {
            return saleRepository.findById(referenceId).map(sale -> support.contactDisplayName(sale.getCustomer())).orElse(null);
        }
        if ("PURCHASE".equals(transactionType)) {
            return purchaseRepository.findById(referenceId).map(purchase -> support.contactDisplayName(purchase.getSupplier())).orElse(null);
        }
        return null;
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

    private static class DueAccumulator {
        private final Long id;
        private final String name;
        private BigDecimal dueAmount = TransactionSupport.ZERO;

        private DueAccumulator(Long id, String name) {
            this.id = id;
            this.name = name;
        }
    }
}
