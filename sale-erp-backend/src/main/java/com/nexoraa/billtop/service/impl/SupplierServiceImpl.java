package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.ledger.LedgerResponseDto;
import com.nexoraa.billtop.dto.ledger.LedgerTransactionResponseDto;
import com.nexoraa.billtop.dto.supplier.SupplierCreateResponseDto;
import com.nexoraa.billtop.dto.supplier.SupplierDetailResponseDto;
import com.nexoraa.billtop.dto.supplier.SupplierListResponseDto;
import com.nexoraa.billtop.dto.supplier.SupplierRequestDto;
import com.nexoraa.billtop.entity.Contact;
import com.nexoraa.billtop.entity.Payment;
import com.nexoraa.billtop.entity.Purchase;
import com.nexoraa.billtop.entity.PurchaseReturn;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.mapper.SupplierMapper;
import com.nexoraa.billtop.repository.ContactRepository;
import com.nexoraa.billtop.repository.PaymentRepository;
import com.nexoraa.billtop.repository.PurchaseRepository;
import com.nexoraa.billtop.repository.PurchaseReturnRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.SupplierService;
import com.nexoraa.billtop.specification.ContactSpecification;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

@Service
public class SupplierServiceImpl implements SupplierService {

    private static final String SUPPLIER = "SUPPLIER";
    private static final String CANCELLED = "CANCELLED";
    private static final BigDecimal ZERO = BigDecimal.ZERO;

    private final ContactRepository contactRepository;
    private final PurchaseRepository purchaseRepository;
    private final PurchaseReturnRepository purchaseReturnRepository;
    private final PaymentRepository paymentRepository;
    private final SupplierMapper supplierMapper;
    private final CurrentOrganizationService currentOrganizationService;

    public SupplierServiceImpl(
            ContactRepository contactRepository,
            PurchaseRepository purchaseRepository,
            PurchaseReturnRepository purchaseReturnRepository,
            PaymentRepository paymentRepository,
            SupplierMapper supplierMapper,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.contactRepository = contactRepository;
        this.purchaseRepository = purchaseRepository;
        this.purchaseReturnRepository = purchaseReturnRepository;
        this.paymentRepository = paymentRepository;
        this.supplierMapper = supplierMapper;
        this.currentOrganizationService = currentOrganizationService;
    }

    @Override
    @Transactional
    public SupplierCreateResponseDto createSupplier(SupplierRequestDto request) {
        Contact supplier = supplierMapper.toEntity(request);
        supplier.setOrganization(currentOrganizationService.getOrganizationReference());
        Contact savedSupplier = contactRepository.save(supplier);

        return SupplierCreateResponseDto.builder()
                .id(savedSupplier.getId())
                .supplierCode(supplierMapper.toSupplierCode(savedSupplier.getId()))
                .build();
    }

    @Override
    @Transactional
    public void updateSupplier(Long id, SupplierRequestDto request) {
        Contact supplier = getActiveSupplier(id);
        supplierMapper.updateEntity(request, supplier);
        contactRepository.save(supplier);
    }

    @Override
    @Transactional(readOnly = true)
    public SupplierDetailResponseDto getSupplierById(Long id) {
        Contact supplier = getActiveSupplier(id);
        SupplierDetailResponseDto response = supplierMapper.toDetailResponse(supplier);
        response.setCurrentBalance(calculateSupplierBalance(supplier));
        return response;
    }

    @Override
    @Transactional(readOnly = true)
    public PageResponseDto<SupplierListResponseDto> getSuppliers(int page, int size, String search) {
        Specification<Contact> specification = ContactSpecification.activeByType(SUPPLIER)
                .and(ContactSpecification.organization(currentOrganizationService.getOrganizationId()))
                .and(ContactSpecification.search(search));
        Page<Contact> suppliers = contactRepository.findAll(
                specification,
                PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "id"))
        );
        return PageResponseDto.from(suppliers.map(supplier -> {
            SupplierListResponseDto response = supplierMapper.toListResponse(supplier);
            response.setBalance(calculateSupplierBalance(supplier));
            return response;
        }));
    }

    @Override
    @Transactional
    public void deleteSupplier(Long id) {
        Contact supplier = getActiveSupplier(id);
        supplier.setStatus(com.nexoraa.billtop.enums.Status.INACTIVE);
        contactRepository.save(supplier);
    }

    @Override
    @Transactional(readOnly = true)
    public LedgerResponseDto getSupplierLedger(Long id) {
        Contact supplier = getActiveSupplier(id);
        BigDecimal balance = defaultZero(supplier.getOpeningBalance());
        List<LedgerEntry> entries = new ArrayList<>();

        for (Purchase purchase : purchaseRepository.findBySupplierIdAndOrganizationIdOrderByPurchaseDateAscIdAsc(
                id,
                currentOrganizationService.getOrganizationId()
        )) {
            if (isCancelled(purchase.getStatus())) {
                continue;
            }
            BigDecimal amount = defaultZero(purchase.getGrandTotal());
            entries.add(new LedgerEntry(purchase.getPurchaseDate(), "PURCHASE", purchase.getPurchaseNo(), ZERO, amount));
        }

        for (PurchaseReturn purchaseReturn : purchaseReturnRepository.findBySupplierIdAndOrganizationIdOrderByReturnDateAscIdAsc(
                id,
                currentOrganizationService.getOrganizationId()
        )) {
            BigDecimal amount = defaultZero(purchaseReturn.getGrandTotal());
            entries.add(new LedgerEntry(purchaseReturn.getReturnDate(), "PURCHASE_RETURN", purchaseReturn.getReturnNo(), amount, ZERO));
        }

        for (Payment payment : paymentRepository.findByContactIdAndOrganizationIdOrderByPaymentDateAscIdAsc(
                id,
                currentOrganizationService.getOrganizationId()
        )) {
            BigDecimal amount = defaultZero(payment.getAmount());
            entries.add(new LedgerEntry(payment.getPaymentDate(), "PAYMENT", payment.getPaymentNo(), amount, ZERO));
        }

        entries.sort(Comparator.comparing(LedgerEntry::date, Comparator.nullsLast(LocalDate::compareTo)));
        List<LedgerTransactionResponseDto> transactions = new ArrayList<>();
        for (LedgerEntry entry : entries) {
            balance = balance.add(entry.credit()).subtract(entry.debit());
            transactions.add(LedgerTransactionResponseDto.builder()
                    .date(entry.date())
                    .type(entry.type())
                    .referenceNo(entry.referenceNo())
                    .debit(entry.debit())
                    .credit(entry.credit())
                    .balance(balance)
                    .build());
        }

        return LedgerResponseDto.builder()
                .openingBalance(defaultZero(supplier.getOpeningBalance()))
                .transactions(transactions)
                .build();
    }

    private Contact getActiveSupplier(Long id) {
        return contactRepository.findByIdAndContactTypeAndOrganizationIdAndStatus(
                        id,
                        SUPPLIER,
                        currentOrganizationService.getOrganizationId(),
                com.nexoraa.billtop.enums.Status.ACTIVE)
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.SUPPLIER_NOT_FOUND, "SUPPLIER_NOT_FOUND"));
    }

    private BigDecimal defaultZero(BigDecimal value) {
        return value == null ? ZERO : value;
    }

    private BigDecimal calculateSupplierBalance(Contact supplier) {
        BigDecimal purchaseTotal = purchaseRepository.findBySupplierIdAndOrganizationIdOrderByPurchaseDateAscIdAsc(
                        supplier.getId(),
                        currentOrganizationService.getOrganizationId()
                )
                .stream()
                .filter(purchase -> !isCancelled(purchase.getStatus()))
                .map(Purchase::getGrandTotal)
                .map(this::defaultZero)
                .reduce(ZERO, BigDecimal::add);
        BigDecimal purchaseReturnTotal = purchaseReturnRepository.findBySupplierIdAndOrganizationIdOrderByReturnDateAscIdAsc(
                        supplier.getId(),
                        currentOrganizationService.getOrganizationId()
                )
                .stream()
                .map(PurchaseReturn::getGrandTotal)
                .map(this::defaultZero)
                .reduce(ZERO, BigDecimal::add);
        BigDecimal paymentsTotal = paymentRepository.findByContactIdAndOrganizationIdOrderByPaymentDateAscIdAsc(
                        supplier.getId(),
                        currentOrganizationService.getOrganizationId()
                )
                .stream()
                .map(Payment::getAmount)
                .map(this::defaultZero)
                .reduce(ZERO, BigDecimal::add);
        return defaultZero(supplier.getOpeningBalance()).add(purchaseTotal).subtract(purchaseReturnTotal).subtract(paymentsTotal);
    }

    private boolean isCancelled(String status) {
        return CANCELLED.equalsIgnoreCase(status);
    }

    private record LedgerEntry(LocalDate date, String type, String referenceNo, BigDecimal debit, BigDecimal credit) {
    }
}





