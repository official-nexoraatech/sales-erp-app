package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.dto.dashboard.DashboardSummaryResponseDto;
import com.nexoraa.billtop.entity.Expense;
import com.nexoraa.billtop.entity.Payment;
import com.nexoraa.billtop.entity.Purchase;
import com.nexoraa.billtop.entity.Sale;
import com.nexoraa.billtop.repository.ContactRepository;
import com.nexoraa.billtop.repository.ExpenseRepository;
import com.nexoraa.billtop.repository.ItemPriceRepository;
import com.nexoraa.billtop.repository.PaymentRepository;
import com.nexoraa.billtop.repository.PurchaseRepository;
import com.nexoraa.billtop.repository.SaleRepository;
import com.nexoraa.billtop.repository.StockRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.DashboardService;
import com.nexoraa.billtop.specification.ExpenseSpecification;
import com.nexoraa.billtop.specification.PurchaseSpecification;
import com.nexoraa.billtop.specification.SaleSpecification;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

@Service
public class DashboardServiceImpl implements DashboardService {

    private final SaleRepository saleRepository;
    private final PurchaseRepository purchaseRepository;
    private final ExpenseRepository expenseRepository;
    private final PaymentRepository paymentRepository;
    private final StockRepository stockRepository;
    private final ItemPriceRepository itemPriceRepository;
    private final ContactRepository contactRepository;
    private final TransactionSupport support;
    private final FinanceSupport financeSupport;
    private final CurrentOrganizationService currentOrganizationService;

    public DashboardServiceImpl(
            SaleRepository saleRepository,
            PurchaseRepository purchaseRepository,
            ExpenseRepository expenseRepository,
            PaymentRepository paymentRepository,
            StockRepository stockRepository,
            ItemPriceRepository itemPriceRepository,
            ContactRepository contactRepository,
            TransactionSupport support,
            FinanceSupport financeSupport,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.saleRepository = saleRepository;
        this.purchaseRepository = purchaseRepository;
        this.expenseRepository = expenseRepository;
        this.paymentRepository = paymentRepository;
        this.stockRepository = stockRepository;
        this.itemPriceRepository = itemPriceRepository;
        this.contactRepository = contactRepository;
        this.support = support;
        this.financeSupport = financeSupport;
        this.currentOrganizationService = currentOrganizationService;
    }

    @Override
    @Transactional(readOnly = false)
    public DashboardSummaryResponseDto getSummary(LocalDate fromDate, LocalDate toDate) {
        LocalDate today = LocalDate.now();
        List<Sale> periodSales = salesBetween(fromDate, toDate);
        List<Purchase> periodPurchases = purchasesBetween(fromDate, toDate);
        List<Expense> periodExpenses = expensesBetween(fromDate, toDate);
        BigDecimal todaySales = saleRepository.findAll(todaySalesSpec(today)).stream()
                .map(Sale::getGrandTotal)
                .map(support::defaultZero)
                .reduce(TransactionSupport.ZERO, BigDecimal::add);
        BigDecimal todayPurchase = purchaseRepository.findAll(todayPurchaseSpec(today)).stream()
                .map(Purchase::getGrandTotal)
                .map(support::defaultZero)
                .reduce(TransactionSupport.ZERO, BigDecimal::add);
        BigDecimal todayExpense = expenseRepository.findByExpenseDateBetweenAndOrganizationIdOrderByExpenseDateAscIdAsc(
                        today,
                        today,
                        currentOrganizationService.getOrganizationId()
                )
                .stream()
                .map(Expense::getAmount)
                .map(support::defaultZero)
                .reduce(TransactionSupport.ZERO, BigDecimal::add);
        BigDecimal todayCollection = paymentRepository.findByPaymentDateAndPaymentTypeInAndOrganizationId(
                        today,
                        List.of(FinanceSupport.PAYMENT_IN, FinanceSupport.POS),
                        currentOrganizationService.getOrganizationId()
                ).stream()
                .map(Payment::getAmount)
                .map(support::defaultZero)
                .reduce(TransactionSupport.ZERO, BigDecimal::add);
        BigDecimal paymentReceivables = periodSales.stream()
                .map(Sale::getDueAmount)
                .map(support::defaultZero)
                .reduce(TransactionSupport.ZERO, BigDecimal::add);
        BigDecimal paymentPayables = periodPurchases.stream()
                .map(Purchase::getDueAmount)
                .map(support::defaultZero)
                .reduce(TransactionSupport.ZERO, BigDecimal::add);
        BigDecimal totalExpense = periodExpenses.stream()
                .map(Expense::getAmount)
                .map(support::defaultZero)
                .reduce(TransactionSupport.ZERO, BigDecimal::add);

        return DashboardSummaryResponseDto.builder()
                .todaySales(support.money(todaySales))
                .todayPurchase(support.money(todayPurchase))
                .todayExpense(support.money(todayExpense))
                .todayCollection(support.money(todayCollection))
                .cashInHand(financeSupport.totalCashBalance())
                .bankBalance(financeSupport.totalBankBalance())
                .stockValue(stockValue())
                .totalCustomers(contactRepository.countByContactTypeAndOrganizationIdAndStatus(
                        TransactionSupport.CUSTOMER,
                        currentOrganizationService.getOrganizationId(),
                com.nexoraa.billtop.enums.Status.ACTIVE))
                .totalSuppliers(contactRepository.countByContactTypeAndOrganizationIdAndStatus(
                        TransactionSupport.SUPPLIER,
                        currentOrganizationService.getOrganizationId(),
                com.nexoraa.billtop.enums.Status.ACTIVE))
                .lowStockItems(lowStockCount())
                .pendingSaleOrders(periodSales.stream().filter(sale -> !isCompleted(sale.getStatus(), sale.getDueAmount())).count())
                .completedSaleOrders(periodSales.stream().filter(sale -> isCompleted(sale.getStatus(), sale.getDueAmount())).count())
                .paymentReceivables(support.money(paymentReceivables))
                .paymentPayables(support.money(paymentPayables))
                .pendingPurchaseOrders(periodPurchases.stream().filter(purchase -> !isCompleted(purchase.getStatus(), purchase.getDueAmount())).count())
                .completedPurchaseOrders(periodPurchases.stream().filter(purchase -> isCompleted(purchase.getStatus(), purchase.getDueAmount())).count())
                .totalExpense(support.money(totalExpense))
                .build();
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

    private List<Expense> expensesBetween(LocalDate fromDate, LocalDate toDate) {
        return expenseRepository.findAll(ExpenseSpecification.notDeleted()
                .and(ExpenseSpecification.organization(currentOrganizationService.getOrganizationId()))
                .and(ExpenseSpecification.dateBetween(fromDate, toDate)));
    }

    private boolean isCompleted(String status, BigDecimal balance) {
        String normalized = status == null ? "" : status.trim().toUpperCase();
        return List.of("PAID", "COMPLETED", "COMPLETE", "CLOSED").contains(normalized)
                || support.defaultZero(balance).compareTo(TransactionSupport.ZERO) <= 0;
    }

    private Specification<Sale> todaySalesSpec(LocalDate today) {
        return SaleSpecification.notCancelled()
                .and(SaleSpecification.notDeleted())
                .and(SaleSpecification.organization(currentOrganizationService.getOrganizationId()))
                .and(SaleSpecification.dateBetween(today, today));
    }

    private Specification<Purchase> todayPurchaseSpec(LocalDate today) {
        return PurchaseSpecification.notCancelled()
                .and(PurchaseSpecification.notDeleted())
                .and(PurchaseSpecification.organization(currentOrganizationService.getOrganizationId()))
                .and(PurchaseSpecification.dateBetween(today, today));
    }

    private BigDecimal stockValue() {
        return support.money(stockRepository.findByItem_Organization_Id(currentOrganizationService.getOrganizationId()).stream()
                .map(stock -> support.defaultZero(stock.getAvailableQty()).multiply(itemPurchasePrice(stock.getItem().getId())))
                .reduce(TransactionSupport.ZERO, BigDecimal::add));
    }

    private long lowStockCount() {
        return stockRepository.findByItem_Organization_Id(currentOrganizationService.getOrganizationId()).stream()
                .filter(stock -> support.defaultZero(stock.getAvailableQty())
                        .compareTo(support.defaultZero(stock.getReorderLevel())) <= 0)
                .count();
    }

    private BigDecimal itemPurchasePrice(Long itemId) {
        return itemPriceRepository.findTopByItemIdOrderByIdDesc(itemId)
                .map(price -> support.defaultZero(price.getPurchasePrice()))
                .orElse(TransactionSupport.ZERO);
    }
}
