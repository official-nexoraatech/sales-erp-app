package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.common.NameIdResponseDto;
import com.nexoraa.billtop.dto.payment.PaymentDetailResponseDto;
import com.nexoraa.billtop.dto.payment.PaymentListResponseDto;
import com.nexoraa.billtop.dto.payment.PaymentOutCreateResponseDto;
import com.nexoraa.billtop.dto.payment.PaymentOutRequestDto;
import com.nexoraa.billtop.entity.Contact;
import com.nexoraa.billtop.entity.Payment;
import com.nexoraa.billtop.entity.PaymentMethod;
import com.nexoraa.billtop.entity.Purchase;
import com.nexoraa.billtop.entity.PurchasePayment;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.repository.PaymentRepository;
import com.nexoraa.billtop.repository.PurchasePaymentRepository;
import com.nexoraa.billtop.repository.PurchaseRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.PaymentOutService;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.List;

@Service
public class PaymentOutServiceImpl implements PaymentOutService {

    private static final String PREFIX = "POUT-";
    private static final String SYSTEM = "SYSTEM";

    private final PaymentRepository paymentRepository;
    private final PurchaseRepository purchaseRepository;
    private final PurchasePaymentRepository purchasePaymentRepository;
    private final TransactionSupport support;
    private final FinanceSupport financeSupport;
    private final CurrentOrganizationService currentOrganizationService;

    public PaymentOutServiceImpl(
            PaymentRepository paymentRepository,
            PurchaseRepository purchaseRepository,
            PurchasePaymentRepository purchasePaymentRepository,
            TransactionSupport support,
            FinanceSupport financeSupport,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.paymentRepository = paymentRepository;
        this.purchaseRepository = purchaseRepository;
        this.purchasePaymentRepository = purchasePaymentRepository;
        this.support = support;
        this.financeSupport = financeSupport;
        this.currentOrganizationService = currentOrganizationService;
    }

    @Override
    @Transactional
    public PaymentOutCreateResponseDto createPaymentOut(PaymentOutRequestDto request) {
        Contact supplier = support.getActiveSupplier(request.getSupplierId());
        PaymentMethod paymentMethod = support.getActivePaymentMethod(request.getPaymentMethodId());
        Payment payment = paymentRepository.save(Payment.builder()
                .organization(currentOrganizationService.getOrganizationReference())
                .paymentNo(nextPaymentNo())
                .paymentType(FinanceSupport.PAYMENT_OUT)
                .paymentMethod(paymentMethod)
                .contact(supplier)
                .amount(support.money(request.getAmount()))
                .paymentDate(request.getPaymentDate())
                .referenceNo(request.getReferenceNo())
                .notes(request.getNotes())
                .build());

        allocateToPurchases(payment, supplier.getId(), request.getPurchaseIds());
        financeSupport.saveMoneyMovement(payment, FinanceSupport.PAYMENT_OUT);

        return PaymentOutCreateResponseDto.builder()
                .paymentId(payment.getId())
                .paymentNo(payment.getPaymentNo())
                .amount(payment.getAmount())
                .supplierBalance(financeSupport.supplierBalance(supplier))
                .build();
    }

    @Override
    @Transactional(readOnly = true)
    public PageResponseDto<PaymentListResponseDto> getPaymentOuts(int page, int size) {
        Page<Payment> payments = paymentRepository.findByPaymentTypeAndOrganizationIdOrderByIdDesc(
                FinanceSupport.PAYMENT_OUT,
                currentOrganizationService.getOrganizationId(),
                PageRequest.of(page, size)
        );
        return PageResponseDto.from(payments.map(payment -> PaymentListResponseDto.builder()
                .paymentId(payment.getId())
                .paymentNo(payment.getPaymentNo())
                .partyName(support.contactDisplayName(payment.getContact()))
                .supplierName(support.contactDisplayName(payment.getContact()))
                .amount(payment.getAmount())
                .paymentDate(payment.getPaymentDate())
                .build()));
    }

    @Override
    @Transactional(readOnly = true)
    public PaymentDetailResponseDto getPaymentOutById(Long id) {
        Payment payment = getPayment(id);
        if (!FinanceSupport.PAYMENT_OUT.equals(payment.getPaymentType())) {
            throw new ResourceNotFoundException("Payment out not found", "PAYMENT_OUT_NOT_FOUND");
        }
        return toDetailResponse(payment);
    }

    private void allocateToPurchases(Payment payment, Long supplierId, List<Long> purchaseIds) {
        BigDecimal remaining = support.defaultZero(payment.getAmount());
        if (purchaseIds == null || purchaseIds.isEmpty()) {
            return;
        }

        for (Long purchaseId : purchaseIds) {
            if (remaining.compareTo(TransactionSupport.ZERO) <= 0) {
                break;
            }
            Purchase purchase = purchaseRepository.findByIdAndOrganizationId(purchaseId, currentOrganizationService.getOrganizationId())
                    .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.PURCHASE_NOT_FOUND, "PURCHASE_NOT_FOUND"));
            if (purchase.getSupplier() == null || !purchase.getSupplier().getId().equals(supplierId)) {
                throw new BadRequestException("Purchase does not belong to supplier", "SUPPLIER_PURCHASE_MISMATCH");
            }
            if (support.isCancelled(purchase.getStatus())) {
                throw new BadRequestException(ErrorMessage.PURCHASE_ALREADY_CANCELLED, "PURCHASE_ALREADY_CANCELLED");
            }
            BigDecimal dueAmount = support.defaultZero(purchase.getDueAmount());
            if (dueAmount.compareTo(TransactionSupport.ZERO) <= 0) {
                continue;
            }
            BigDecimal allocated = dueAmount.min(remaining);
            purchase.setPaidAmount(support.money(support.defaultZero(purchase.getPaidAmount()).add(allocated)));
            purchase.setDueAmount(support.money(dueAmount.subtract(allocated)));
            if (purchase.getDueAmount().compareTo(TransactionSupport.ZERO) == 0) {
                purchase.setStatus(TransactionSupport.STATUS_PAID);
            }
            purchaseRepository.save(purchase);
            purchasePaymentRepository.save(PurchasePayment.builder()
                    .organization(currentOrganizationService.getOrganizationReference())
                    .purchase(purchase)
                    .payment(payment)
                    .amount(support.money(allocated))
                    .build());
            remaining = remaining.subtract(allocated);
        }
    }

    private Payment getPayment(Long id) {
        return paymentRepository.findByIdAndOrganizationId(id, currentOrganizationService.getOrganizationId())
                .orElseThrow(() -> new ResourceNotFoundException("Payment not found", "PAYMENT_NOT_FOUND"));
    }

    private String nextPaymentNo() {
        String currentNumber = paymentRepository.findTopByPaymentNoStartingWithAndOrganizationIdOrderByIdDesc(
                        PREFIX,
                        currentOrganizationService.getOrganizationId()
                )
                .map(Payment::getPaymentNo)
                .orElse(null);
        return support.nextNumber(PREFIX, currentNumber);
    }

    private PaymentDetailResponseDto toDetailResponse(Payment payment) {
        PaymentMethod method = payment.getPaymentMethod();
        return PaymentDetailResponseDto.builder()
                .paymentId(payment.getId())
                .paymentNo(payment.getPaymentNo())
                .paymentType(payment.getPaymentType())
                .party(support.toNameId(payment.getContact()))
                .paymentMethod(method == null ? null : NameIdResponseDto.builder().id(method.getId()).name(method.getName()).build())
                .paymentDate(payment.getPaymentDate())
                .referenceNo(payment.getReferenceNo())
                .amount(payment.getAmount())
                .notes(payment.getNotes())
                .purchaseIds(purchasePaymentRepository.findByPaymentIdAndOrganizationId(
                                payment.getId(),
                                currentOrganizationService.getOrganizationId()
                        ).stream()
                        .map(PurchasePayment::getPurchase)
                        .map(Purchase::getId)
                        .toList())
                .build();
    }
}


