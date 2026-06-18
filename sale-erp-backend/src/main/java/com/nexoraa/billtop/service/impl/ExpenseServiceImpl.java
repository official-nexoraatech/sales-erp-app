package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.common.NameIdResponseDto;
import com.nexoraa.billtop.dto.expense.ExpenseCreateResponseDto;
import com.nexoraa.billtop.dto.expense.ExpenseRequestDto;
import com.nexoraa.billtop.dto.expense.ExpenseResponseDto;
import com.nexoraa.billtop.entity.Expense;
import com.nexoraa.billtop.entity.ExpenseCategory;
import com.nexoraa.billtop.entity.Payment;
import com.nexoraa.billtop.entity.PaymentMethod;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.repository.ExpenseCategoryRepository;
import com.nexoraa.billtop.repository.ExpenseRepository;
import com.nexoraa.billtop.repository.PaymentRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.ExpenseService;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;


@Service
public class ExpenseServiceImpl implements ExpenseService {

    private static final String EXPENSE_PREFIX = "EXP-";
    private static final String EXPENSE_PAYMENT_PREFIX = "EXP-PAY-";
    private static final String SYSTEM = "SYSTEM";

    private final ExpenseRepository expenseRepository;
    private final ExpenseCategoryRepository expenseCategoryRepository;
    private final PaymentRepository paymentRepository;
    private final TransactionSupport support;
    private final FinanceSupport financeSupport;
    private final CurrentOrganizationService currentOrganizationService;

    public ExpenseServiceImpl(
            ExpenseRepository expenseRepository,
            ExpenseCategoryRepository expenseCategoryRepository,
            PaymentRepository paymentRepository,
            TransactionSupport support,
            FinanceSupport financeSupport,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.expenseRepository = expenseRepository;
        this.expenseCategoryRepository = expenseCategoryRepository;
        this.paymentRepository = paymentRepository;
        this.support = support;
        this.financeSupport = financeSupport;
        this.currentOrganizationService = currentOrganizationService;
    }

    @Override
    @Transactional
    public ExpenseCreateResponseDto createExpense(ExpenseRequestDto request) {
        Expense expense = Expense.builder()
                .organization(currentOrganizationService.getOrganizationReference())
                .expenseNo(nextExpenseNo())
                .expenseCategory(getExpenseCategory(request.getExpenseCategoryId()))
                .expenseDate(request.getExpenseDate())
                .amount(support.money(request.getAmount()))
                .paymentMethod(support.getActivePaymentMethod(request.getPaymentMethodId()))
                .notes(request.getNotes())
                .build();
        Expense savedExpense = expenseRepository.save(expense);
        saveExpensePayment(savedExpense);
        return ExpenseCreateResponseDto.builder()
                .expenseId(savedExpense.getId())
                .expenseNo(savedExpense.getExpenseNo())
                .build();
    }

    @Override
    @Transactional(readOnly = true)
    public PageResponseDto<ExpenseResponseDto> getExpenses(int page, int size) {
        Page<Expense> expenses = expenseRepository.findByOrganizationId(
                currentOrganizationService.getOrganizationId(),
                PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "id"))
        );
        return PageResponseDto.from(expenses.map(this::toResponse));
    }

    @Override
    @Transactional(readOnly = true)
    public ExpenseResponseDto getExpenseById(Long id) {
        return toResponse(getExpense(id));
    }

    @Override
    @Transactional
    public void updateExpense(Long id, ExpenseRequestDto request) {
        Expense expense = getExpense(id);
        expense.setExpenseCategory(getExpenseCategory(request.getExpenseCategoryId()));
        expense.setExpenseDate(request.getExpenseDate());
        expense.setAmount(support.money(request.getAmount()));
        expense.setPaymentMethod(support.getActivePaymentMethod(request.getPaymentMethodId()));
        expense.setNotes(request.getNotes());
        Expense savedExpense = expenseRepository.save(expense);
        saveExpensePayment(savedExpense);
    }

    @Override
    @Transactional
    public void deleteExpense(Long id) {
        Expense expense = getExpense(id);
        paymentRepository.findByReferenceNoAndPaymentTypeAndOrganizationId(
                        expense.getExpenseNo(),
                        FinanceSupport.EXPENSE,
                        currentOrganizationService.getOrganizationId()
                )
                .ifPresent(payment -> {
                    financeSupport.deleteMoneyMovement(payment);
                    paymentRepository.delete(payment);
                });
        expenseRepository.delete(expense);
    }

    private void saveExpensePayment(Expense expense) {
        Payment payment = paymentRepository.findByReferenceNoAndPaymentTypeAndOrganizationId(
                        expense.getExpenseNo(),
                        FinanceSupport.EXPENSE,
                        currentOrganizationService.getOrganizationId()
                )
                .orElseGet(() -> Payment.builder()
                        .organization(currentOrganizationService.getOrganizationReference())
                        .paymentNo(nextExpensePaymentNo())
                        .paymentType(FinanceSupport.EXPENSE)
                        .referenceNo(expense.getExpenseNo())
                        .build());
        payment.setPaymentMethod(expense.getPaymentMethod());
        payment.setAmount(expense.getAmount());
        payment.setPaymentDate(expense.getExpenseDate());
        payment.setNotes(expense.getNotes());
        Payment savedPayment = paymentRepository.save(payment);
        financeSupport.saveMoneyMovement(savedPayment, FinanceSupport.EXPENSE);
    }

    private Expense getExpense(Long id) {
        return expenseRepository.findByIdAndOrganizationId(id, currentOrganizationService.getOrganizationId())
                .orElseThrow(() -> new ResourceNotFoundException("Expense not found", "EXPENSE_NOT_FOUND"));
    }

    private ExpenseCategory getExpenseCategory(Long id) {
        return expenseCategoryRepository.findByIdAndStatus(id, com.nexoraa.billtop.enums.Status.ACTIVE)
                .orElseThrow(() -> new ResourceNotFoundException("Expense category not found", "EXPENSE_CATEGORY_NOT_FOUND"));
    }

    private String nextExpenseNo() {
        String currentNumber = expenseRepository.findTopByExpenseNoStartingWithAndOrganizationIdOrderByIdDesc(
                        EXPENSE_PREFIX,
                        currentOrganizationService.getOrganizationId()
                )
                .map(Expense::getExpenseNo)
                .orElse(null);
        return support.nextNumber(EXPENSE_PREFIX, currentNumber);
    }

    private String nextExpensePaymentNo() {
        String currentNumber = paymentRepository.findTopByPaymentNoStartingWithAndOrganizationIdOrderByIdDesc(
                        EXPENSE_PAYMENT_PREFIX,
                        currentOrganizationService.getOrganizationId()
                )
                .map(Payment::getPaymentNo)
                .orElse(null);
        return support.nextNumber(EXPENSE_PAYMENT_PREFIX, currentNumber);
    }

    private ExpenseResponseDto toResponse(Expense expense) {
        PaymentMethod method = expense.getPaymentMethod();
        ExpenseCategory category = expense.getExpenseCategory();
        return ExpenseResponseDto.builder()
                .expenseId(expense.getId())
                .expenseNo(expense.getExpenseNo())
                .expenseCategory(category == null ? null : NameIdResponseDto.builder().id(category.getId()).name(category.getName()).build())
                .expenseDate(expense.getExpenseDate())
                .amount(expense.getAmount())
                .paymentMethod(method == null ? null : NameIdResponseDto.builder().id(method.getId()).name(method.getName()).build())
                .notes(expense.getNotes())
                .build();
    }
}



