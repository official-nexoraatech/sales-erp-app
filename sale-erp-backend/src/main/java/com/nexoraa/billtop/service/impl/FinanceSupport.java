package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.dto.cash.CashSummaryResponseDto;
import com.nexoraa.billtop.entity.BankAccount;
import com.nexoraa.billtop.entity.BankTransaction;
import com.nexoraa.billtop.entity.CashAccount;
import com.nexoraa.billtop.entity.CashTransaction;
import com.nexoraa.billtop.entity.Contact;
import com.nexoraa.billtop.entity.Organization;
import com.nexoraa.billtop.entity.Payment;
import com.nexoraa.billtop.entity.PaymentMethod;
import com.nexoraa.billtop.entity.Purchase;
import com.nexoraa.billtop.entity.PurchaseReturn;
import com.nexoraa.billtop.entity.Sale;
import com.nexoraa.billtop.entity.SalesReturn;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.repository.BankAccountRepository;
import com.nexoraa.billtop.repository.BankTransactionRepository;
import com.nexoraa.billtop.repository.CashTransactionRepository;
import com.nexoraa.billtop.repository.PaymentRepository;
import com.nexoraa.billtop.repository.PurchaseRepository;
import com.nexoraa.billtop.repository.PurchaseReturnRepository;
import com.nexoraa.billtop.repository.SaleRepository;
import com.nexoraa.billtop.repository.SalesReturnRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.math.BigDecimal;
import java.util.List;
import java.util.Locale;

@Component
class FinanceSupport {

    static final String PAYMENT_IN = "PAYMENT_IN";
    static final String PAYMENT_OUT = "PAYMENT_OUT";
    static final String POS = "POS";
    static final String EXPENSE = "EXPENSE";

    private final BankAccountRepository bankAccountRepository;
    private final BankTransactionRepository bankTransactionRepository;
    private final CashTransactionRepository cashTransactionRepository;
    private final SaleRepository saleRepository;
    private final SalesReturnRepository salesReturnRepository;
    private final PurchaseRepository purchaseRepository;
    private final PurchaseReturnRepository purchaseReturnRepository;
    private final PaymentRepository paymentRepository;
    private final TransactionSupport support;
    private final CurrentOrganizationService currentOrganizationService;
    private final AccountProvisioningService accountProvisioningService;

    FinanceSupport(
            BankAccountRepository bankAccountRepository,
            BankTransactionRepository bankTransactionRepository,
            CashTransactionRepository cashTransactionRepository,
            SaleRepository saleRepository,
            SalesReturnRepository salesReturnRepository,
            PurchaseRepository purchaseRepository,
            PurchaseReturnRepository purchaseReturnRepository,
            PaymentRepository paymentRepository,
            TransactionSupport support,
            CurrentOrganizationService currentOrganizationService,
            AccountProvisioningService accountProvisioningService
    ) {
        this.bankAccountRepository = bankAccountRepository;
        this.bankTransactionRepository = bankTransactionRepository;
        this.cashTransactionRepository = cashTransactionRepository;
        this.saleRepository = saleRepository;
        this.salesReturnRepository = salesReturnRepository;
        this.purchaseRepository = purchaseRepository;
        this.purchaseReturnRepository = purchaseReturnRepository;
        this.paymentRepository = paymentRepository;
        this.support = support;
        this.currentOrganizationService = currentOrganizationService;
        this.accountProvisioningService = accountProvisioningService;
    }

    void saveMoneyMovement(Payment payment, String transactionType) {
        deleteMoneyMovement(payment);
        Organization organization = payment.getOrganization();
        if (isCash(payment.getPaymentMethod())) {
            cashTransactionRepository.save(CashTransaction.builder()
                    .organization(organization)
                    .cashAccount(getOrCreateCashAccount(organization))
                    .payment(payment)
                    .transactionType(transactionType)
                    .amount(support.money(payment.getAmount()))
                    .transactionDate(payment.getPaymentDate())
                    .remarks(payment.getNotes())
                    .build());
            return;
        }

        bankTransactionRepository.save(BankTransaction.builder()
                .organization(organization)
                .bankAccount(getDefaultBankAccount(organization))
                .payment(payment)
                .transactionType(transactionType)
                .amount(support.money(payment.getAmount()))
                .transactionDate(payment.getPaymentDate())
                .remarks(payment.getNotes())
                .build());
    }

    void deleteMoneyMovement(Payment payment) {
        bankTransactionRepository.deleteAll(bankTransactionRepository.findByPaymentIdAndOrganizationId(
                payment.getId(),
                currentOrganizationService.getOrganizationId()
        ));
        cashTransactionRepository.deleteAll(cashTransactionRepository.findByPaymentIdAndOrganizationId(
                payment.getId(),
                currentOrganizationService.getOrganizationId()
        ));
    }

    BigDecimal customerBalance(Contact customer) {
        BigDecimal salesTotal = saleRepository.findByCustomerIdAndOrganizationIdOrderByInvoiceDateAscIdAsc(
                        customer.getId(),
                        currentOrganizationService.getOrganizationId()
                ).stream()
                .filter(sale -> !support.isCancelled(sale.getStatus()))
                .map(Sale::getGrandTotal)
                .map(support::defaultZero)
                .reduce(TransactionSupport.ZERO, BigDecimal::add);
        BigDecimal salesReturnTotal = salesReturnRepository.findByCustomerIdAndOrganizationIdOrderByReturnDateAscIdAsc(
                        customer.getId(),
                        currentOrganizationService.getOrganizationId()
                )
                .stream()
                .map(SalesReturn::getGrandTotal)
                .map(support::defaultZero)
                .reduce(TransactionSupport.ZERO, BigDecimal::add);
        BigDecimal paymentsTotal = paymentRepository.findByContactIdAndOrganizationIdOrderByPaymentDateAscIdAsc(
                        customer.getId(),
                        currentOrganizationService.getOrganizationId()
                )
                .stream()
                .filter(payment -> PAYMENT_IN.equals(payment.getPaymentType()) || POS.equals(payment.getPaymentType()))
                .map(Payment::getAmount)
                .map(support::defaultZero)
                .reduce(TransactionSupport.ZERO, BigDecimal::add);
        return support.money(support.defaultZero(customer.getOpeningBalance())
                .add(salesTotal)
                .subtract(salesReturnTotal)
                .subtract(paymentsTotal));
    }

    BigDecimal supplierBalance(Contact supplier) {
        BigDecimal purchaseTotal = purchaseRepository.findBySupplierIdAndOrganizationIdOrderByPurchaseDateAscIdAsc(
                        supplier.getId(),
                        currentOrganizationService.getOrganizationId()
                )
                .stream()
                .filter(purchase -> !support.isCancelled(purchase.getStatus()))
                .map(Purchase::getGrandTotal)
                .map(support::defaultZero)
                .reduce(TransactionSupport.ZERO, BigDecimal::add);
        BigDecimal purchaseReturnTotal = purchaseReturnRepository.findBySupplierIdAndOrganizationIdOrderByReturnDateAscIdAsc(
                        supplier.getId(),
                        currentOrganizationService.getOrganizationId()
                )
                .stream()
                .map(PurchaseReturn::getGrandTotal)
                .map(support::defaultZero)
                .reduce(TransactionSupport.ZERO, BigDecimal::add);
        BigDecimal paymentsTotal = paymentRepository.findByContactIdAndOrganizationIdOrderByPaymentDateAscIdAsc(
                        supplier.getId(),
                        currentOrganizationService.getOrganizationId()
                )
                .stream()
                .filter(payment -> PAYMENT_OUT.equals(payment.getPaymentType()))
                .map(Payment::getAmount)
                .map(support::defaultZero)
                .reduce(TransactionSupport.ZERO, BigDecimal::add);
        return support.money(support.defaultZero(supplier.getOpeningBalance())
                .add(purchaseTotal)
                .subtract(purchaseReturnTotal)
                .subtract(paymentsTotal));
    }

    CashSummaryResponseDto cashSummary() {
        Organization organization = currentOrganizationService.getOrganizationReference();
        Long organizationId = organization.getId();
        CashAccount cashAccount = getOrCreateCashAccount(organization);
        BigDecimal received = TransactionSupport.ZERO;
        BigDecimal paid = TransactionSupport.ZERO;
        for (CashTransaction transaction : cashTransactionRepository.findByOrganizationIdOrderByTransactionDateAscIdAsc(
                organizationId
        )) {
            BigDecimal amount = support.defaultZero(transaction.getAmount());
            if (isPositive(transaction.getTransactionType())) {
                received = received.add(amount);
            } else {
                paid = paid.add(amount);
            }
        }
        BigDecimal openingBalance = support.defaultZero(cashAccount.getOpeningBalance());
        return CashSummaryResponseDto.builder()
                .openingBalance(support.money(openingBalance))
                .received(support.money(received))
                .paid(support.money(paid))
                .currentBalance(support.money(openingBalance.add(received).subtract(paid)))
                .build();
    }

    BigDecimal bankBalance(BankAccount bankAccount) {
        BigDecimal balance = support.defaultZero(bankAccount.getOpeningBalance());
        for (BankTransaction transaction : bankTransactionRepository.findByBankAccountIdAndOrganizationIdOrderByTransactionDateAscIdAsc(
                bankAccount.getId(),
                currentOrganizationService.getOrganizationId()
        )) {
            BigDecimal amount = support.defaultZero(transaction.getAmount());
            balance = isPositive(transaction.getTransactionType()) ? balance.add(amount) : balance.subtract(amount);
        }
        return support.money(balance);
    }

    BigDecimal totalBankBalance() {
        return bankAccountRepository.findByOrganizationIdAndStatusOrderByIdDesc(
                        currentOrganizationService.getOrganizationId(),
                com.nexoraa.billtop.enums.Status.ACTIVE)
                .stream()
                .map(this::bankBalance)
                .reduce(TransactionSupport.ZERO, BigDecimal::add);
    }

    BigDecimal totalCashBalance() {
        return cashSummary().getCurrentBalance();
    }

    private boolean isPositive(String transactionType) {
        return PAYMENT_IN.equals(transactionType) || POS.equals(transactionType);
    }

    private boolean isCash(PaymentMethod paymentMethod) {
        if (paymentMethod == null || !StringUtils.hasText(paymentMethod.getName())) {
            return false;
        }
        String name = paymentMethod.getName().toLowerCase(Locale.ROOT);
        return name.contains("cash");
    }

    private BankAccount getDefaultBankAccount(Organization organization) {
        return accountProvisioningService.getDefaultBankAccount(organization);
    }

    private CashAccount getOrCreateCashAccount(Organization organization) {
        return accountProvisioningService.getOrCreateCashAccount(organization);
    }
}




