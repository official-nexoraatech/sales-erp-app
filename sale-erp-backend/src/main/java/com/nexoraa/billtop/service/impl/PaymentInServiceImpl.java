package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.common.NameIdResponseDto;
import com.nexoraa.billtop.dto.payment.PaymentDetailResponseDto;
import com.nexoraa.billtop.dto.payment.PaymentInCreateResponseDto;
import com.nexoraa.billtop.dto.payment.PaymentInRequestDto;
import com.nexoraa.billtop.dto.payment.PaymentListResponseDto;
import com.nexoraa.billtop.entity.Contact;
import com.nexoraa.billtop.entity.Organization;
import com.nexoraa.billtop.entity.Payment;
import com.nexoraa.billtop.entity.PaymentMethod;
import com.nexoraa.billtop.entity.Sale;
import com.nexoraa.billtop.entity.SalesPayment;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.repository.PaymentRepository;
import com.nexoraa.billtop.repository.SaleRepository;
import com.nexoraa.billtop.repository.SalesPaymentRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.PaymentInService;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.List;

@Service
public class PaymentInServiceImpl implements PaymentInService {

    private static final String PREFIX = "PIN-";
    private static final String SYSTEM = "SYSTEM";

    private final PaymentRepository paymentRepository;
    private final SaleRepository saleRepository;
    private final SalesPaymentRepository salesPaymentRepository;
    private final TransactionSupport support;
    private final FinanceSupport financeSupport;
    private final CurrentOrganizationService currentOrganizationService;

    public PaymentInServiceImpl(
            PaymentRepository paymentRepository,
            SaleRepository saleRepository,
            SalesPaymentRepository salesPaymentRepository,
            TransactionSupport support,
            FinanceSupport financeSupport,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.paymentRepository = paymentRepository;
        this.saleRepository = saleRepository;
        this.salesPaymentRepository = salesPaymentRepository;
        this.support = support;
        this.financeSupport = financeSupport;
        this.currentOrganizationService = currentOrganizationService;
    }

    @Override
    @Transactional
    public PaymentInCreateResponseDto createPaymentIn(PaymentInRequestDto request) {
        Organization organization = currentOrganizationService.getOrganizationReference();
        Contact customer = support.getActiveCustomer(request.getCustomerId());
        PaymentMethod paymentMethod = support.getActivePaymentMethod(request.getPaymentMethodId());
        Payment payment = paymentRepository.save(Payment.builder()
                .organization(organization)
                .paymentNo(nextPaymentNo())
                .paymentType(FinanceSupport.PAYMENT_IN)
                .paymentMethod(paymentMethod)
                .contact(customer)
                .amount(support.money(request.getAmount()))
                .paymentDate(request.getPaymentDate())
                .referenceNo(request.getReferenceNo())
                .notes(request.getNotes())
                .build());

        allocateToSales(payment, customer.getId(), request.getSaleIds(), organization);
        financeSupport.saveMoneyMovement(payment, FinanceSupport.PAYMENT_IN);

        return PaymentInCreateResponseDto.builder()
                .paymentId(payment.getId())
                .paymentNo(payment.getPaymentNo())
                .amount(payment.getAmount())
                .customerBalance(financeSupport.customerBalance(customer))
                .build();
    }

    @Override
    @Transactional(readOnly = true)
    public PageResponseDto<PaymentListResponseDto> getPaymentIns(int page, int size) {
        Page<Payment> payments = paymentRepository.findByPaymentTypeAndOrganizationIdOrderByIdDesc(
                FinanceSupport.PAYMENT_IN,
                currentOrganizationService.getOrganizationId(),
                PageRequest.of(page, size)
        );
        return PageResponseDto.from(payments.map(payment -> PaymentListResponseDto.builder()
                .paymentId(payment.getId())
                .paymentNo(payment.getPaymentNo())
                .partyName(support.contactDisplayName(payment.getContact()))
                .customerName(support.contactDisplayName(payment.getContact()))
                .amount(payment.getAmount())
                .paymentDate(payment.getPaymentDate())
                .build()));
    }

    @Override
    @Transactional(readOnly = true)
    public PaymentDetailResponseDto getPaymentInById(Long id) {
        Payment payment = getPayment(id);
        if (!FinanceSupport.PAYMENT_IN.equals(payment.getPaymentType())) {
            throw new ResourceNotFoundException("Payment in not found", "PAYMENT_IN_NOT_FOUND");
        }
        return toDetailResponse(payment);
    }

    private void allocateToSales(Payment payment, Long customerId, List<Long> saleIds, Organization organization) {
        BigDecimal remaining = support.defaultZero(payment.getAmount());
        if (saleIds == null || saleIds.isEmpty()) {
            return;
        }

        for (Long saleId : saleIds) {
            if (remaining.compareTo(TransactionSupport.ZERO) <= 0) {
                break;
            }
            Sale sale = saleRepository.findByIdAndOrganizationId(saleId, currentOrganizationService.getOrganizationId())
                    .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.SALE_NOT_FOUND, "SALE_NOT_FOUND"));
            if (sale.getCustomer() == null || !sale.getCustomer().getId().equals(customerId)) {
                throw new BadRequestException("Sale does not belong to customer", "CUSTOMER_SALE_MISMATCH");
            }
            if (support.isCancelled(sale.getStatus())) {
                throw new BadRequestException(ErrorMessage.SALE_ALREADY_CANCELLED, "SALE_ALREADY_CANCELLED");
            }
            BigDecimal dueAmount = support.defaultZero(sale.getDueAmount());
            if (dueAmount.compareTo(TransactionSupport.ZERO) <= 0) {
                continue;
            }
            BigDecimal allocated = dueAmount.min(remaining);
            sale.setPaidAmount(support.money(support.defaultZero(sale.getPaidAmount()).add(allocated)));
            sale.setDueAmount(support.money(dueAmount.subtract(allocated)));
            if (sale.getDueAmount().compareTo(TransactionSupport.ZERO) == 0) {
                sale.setStatus(TransactionSupport.STATUS_PAID);
            }
            saleRepository.save(sale);
            salesPaymentRepository.save(SalesPayment.builder()
                    .organization(organization)
                    .sale(sale)
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
                .saleIds(salesPaymentRepository.findByPaymentIdAndOrganizationId(
                                payment.getId(),
                                currentOrganizationService.getOrganizationId()
                        ).stream()
                        .map(SalesPayment::getSale)
                        .map(Sale::getId)
                        .toList())
                .build();
    }
}


