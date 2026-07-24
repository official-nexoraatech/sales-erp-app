package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.common.NameIdResponseDto;
import com.nexoraa.billtop.dto.paymentnote.PaymentNoteAssignDto;
import com.nexoraa.billtop.dto.paymentnote.PaymentNoteAuditResponseDto;
import com.nexoraa.billtop.dto.paymentnote.PaymentNoteDetailResponseDto;
import com.nexoraa.billtop.dto.paymentnote.PaymentNoteListResponseDto;
import com.nexoraa.billtop.dto.paymentnote.PaymentNoteRequestDto;
import com.nexoraa.billtop.dto.paymentnote.PaymentNoteStatusUpdateDto;
import com.nexoraa.billtop.entity.Contact;
import com.nexoraa.billtop.entity.Organization;
import com.nexoraa.billtop.entity.Payment;
import com.nexoraa.billtop.entity.PaymentNote;
import com.nexoraa.billtop.entity.PaymentNoteAudit;
import com.nexoraa.billtop.entity.Sale;
import com.nexoraa.billtop.entity.User;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.repository.PaymentNoteAuditRepository;
import com.nexoraa.billtop.repository.PaymentNoteRepository;
import com.nexoraa.billtop.repository.PaymentRepository;
import com.nexoraa.billtop.repository.SaleRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.PaymentNoteService;
import com.nexoraa.billtop.specification.PaymentNoteSpecification;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Objects;
import java.util.Set;

@Service
public class PaymentNoteServiceImpl implements PaymentNoteService {

    private static final String NOTE_PREFIX = "PN-";
    private static final String DEFAULT_PRIORITY = "MEDIUM";
    private static final String STATUS_OPEN = "OPEN";
    private static final Set<String> VALID_STATUSES = Set.of("OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED");
    private static final Set<String> VALID_PRIORITIES = Set.of("LOW", "MEDIUM", "HIGH", "URGENT");
    private static final Set<String> VALID_NOTE_TYPES = Set.of(
            "DISCOUNT_NEGOTIATION", "PENDING_PAYMENT", "PAYMENT_DISPUTE", "OTHER"
    );
    private static final Set<String> RESOLVED_STATUSES = Set.of("RESOLVED", "CLOSED");

    private static final String ACTION_CREATED = "CREATED";
    private static final String ACTION_UPDATED = "UPDATED";
    private static final String ACTION_STATUS_CHANGED = "STATUS_CHANGED";
    private static final String ACTION_ASSIGNED = "ASSIGNED";

    private final PaymentNoteRepository paymentNoteRepository;
    private final PaymentNoteAuditRepository paymentNoteAuditRepository;
    private final SaleRepository saleRepository;
    private final PaymentRepository paymentRepository;
    private final TransactionSupport support;
    private final CurrentOrganizationService currentOrganizationService;

    public PaymentNoteServiceImpl(
            PaymentNoteRepository paymentNoteRepository,
            PaymentNoteAuditRepository paymentNoteAuditRepository,
            SaleRepository saleRepository,
            PaymentRepository paymentRepository,
            TransactionSupport support,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.paymentNoteRepository = paymentNoteRepository;
        this.paymentNoteAuditRepository = paymentNoteAuditRepository;
        this.saleRepository = saleRepository;
        this.paymentRepository = paymentRepository;
        this.support = support;
        this.currentOrganizationService = currentOrganizationService;
    }

    @Override
    @Transactional
    public PaymentNoteDetailResponseDto createPaymentNote(PaymentNoteRequestDto request) {
        Organization organization = currentOrganizationService.getOrganizationReference();
        Long organizationId = currentOrganizationService.getOrganizationId();

        PaymentNote paymentNote = new PaymentNote();
        paymentNote.setOrganization(organization);
        paymentNote.setNoteNo(nextNoteNo(organizationId));
        applyRequest(paymentNote, request, organizationId);
        paymentNote.setStatus(STATUS_OPEN);

        PaymentNote saved = paymentNoteRepository.save(paymentNote);
        writeAudit(saved, ACTION_CREATED, null, null, "status=" + saved.getStatus());
        return toDetailResponse(saved);
    }

    @Override
    @Transactional(readOnly = true)
    public PageResponseDto<PaymentNoteListResponseDto> getPaymentNotes(
            int page,
            int size,
            String search,
            LocalDate fromDate,
            LocalDate toDate,
            List<String> status,
            List<String> priority,
            List<String> noteType,
            Long contactId,
            Long assignedToId
    ) {
        Specification<PaymentNote> specification = PaymentNoteSpecification.notDeleted()
                .and(PaymentNoteSpecification.organization(currentOrganizationService.getOrganizationId()))
                .and(PaymentNoteSpecification.search(search))
                .and(PaymentNoteSpecification.dateBetween(fromDate, toDate))
                .and(PaymentNoteSpecification.statusIn(status))
                .and(PaymentNoteSpecification.priorityIn(priority))
                .and(PaymentNoteSpecification.noteTypeIn(noteType))
                .and(PaymentNoteSpecification.contact(contactId))
                .and(PaymentNoteSpecification.assignedTo(assignedToId));
        Page<PaymentNote> paymentNotes = paymentNoteRepository.findAll(
                specification,
                PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "id"))
        );
        return PageResponseDto.from(paymentNotes.map(this::toListResponse));
    }

    @Override
    @Transactional(readOnly = true)
    public PaymentNoteDetailResponseDto getPaymentNoteById(Long id) {
        return toDetailResponse(getPaymentNote(id));
    }

    @Override
    @Transactional
    public void updatePaymentNote(Long id, PaymentNoteRequestDto request) {
        PaymentNote paymentNote = getPaymentNote(id);
        Long organizationId = currentOrganizationService.getOrganizationId();

        String oldSubject = paymentNote.getSubject();
        String oldDescription = paymentNote.getDescription();
        String oldNoteType = paymentNote.getNoteType();
        String oldAmount = paymentNote.getAmount() == null ? null : paymentNote.getAmount().toPlainString();

        applyRequest(paymentNote, request, organizationId);
        PaymentNote saved = paymentNoteRepository.save(paymentNote);

        logFieldChange(saved, "subject", oldSubject, saved.getSubject());
        logFieldChange(saved, "description", oldDescription, saved.getDescription());
        logFieldChange(saved, "noteType", oldNoteType, saved.getNoteType());
        logFieldChange(saved, "amount", oldAmount, saved.getAmount() == null ? null : saved.getAmount().toPlainString());
    }

    @Override
    @Transactional
    public void updateStatus(Long id, PaymentNoteStatusUpdateDto request) {
        PaymentNote paymentNote = getPaymentNote(id);
        String newStatus = request.getStatus() == null ? null : request.getStatus().trim().toUpperCase();
        if (!VALID_STATUSES.contains(newStatus)) {
            throw new BadRequestException(ErrorMessage.INVALID_PAYMENT_NOTE_STATUS, "INVALID_PAYMENT_NOTE_STATUS");
        }

        String oldStatus = paymentNote.getStatus();
        paymentNote.setStatus(newStatus);
        paymentNote.setResolutionNotes(request.getResolutionNotes());
        paymentNote.setResolvedAt(RESOLVED_STATUSES.contains(newStatus) ? LocalDateTime.now() : null);
        paymentNoteRepository.save(paymentNote);

        writeAudit(paymentNote, ACTION_STATUS_CHANGED, "status", oldStatus, newStatus);
    }

    @Override
    @Transactional
    public void assign(Long id, PaymentNoteAssignDto request) {
        PaymentNote paymentNote = getPaymentNote(id);
        User oldAssignee = paymentNote.getAssignedTo();
        User newAssignee = support.getActiveUser(request.getAssignedToId());
        paymentNote.setAssignedTo(newAssignee);
        paymentNoteRepository.save(paymentNote);

        writeAudit(
                paymentNote,
                ACTION_ASSIGNED,
                "assignedTo",
                oldAssignee == null ? null : oldAssignee.getFirstName() + " " + oldAssignee.getLastName(),
                newAssignee == null ? null : newAssignee.getFirstName() + " " + newAssignee.getLastName()
        );
    }

    @Override
    @Transactional
    public void deletePaymentNote(Long id) {
        PaymentNote paymentNote = getPaymentNote(id);
        paymentNote.setIsDeleted(true);
        paymentNoteRepository.save(paymentNote);
    }

    @Override
    @Transactional(readOnly = true)
    public List<PaymentNoteAuditResponseDto> getAuditTrail(Long id) {
        PaymentNote paymentNote = getPaymentNote(id);
        return paymentNoteAuditRepository
                .findByPaymentNoteIdAndOrganizationIdOrderByIdDesc(
                        paymentNote.getId(),
                        currentOrganizationService.getOrganizationId()
                )
                .stream()
                .map(this::toAuditResponse)
                .toList();
    }

    private void applyRequest(PaymentNote paymentNote, PaymentNoteRequestDto request, Long organizationId) {
        Contact contact = support.getActiveCustomer(request.getContactId());
        Sale sale = request.getSaleId() == null
                ? null
                : saleRepository.findByIdAndOrganizationId(request.getSaleId(), organizationId)
                        .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.SALE_NOT_FOUND, "SALE_NOT_FOUND"));
        Payment payment = request.getPaymentId() == null
                ? null
                : paymentRepository.findByIdAndOrganizationId(request.getPaymentId(), organizationId)
                        .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.PAYMENT_NOT_FOUND, "PAYMENT_NOT_FOUND"));

        String noteType = request.getNoteType() == null ? null : request.getNoteType().trim().toUpperCase();
        if (!VALID_NOTE_TYPES.contains(noteType)) {
            throw new BadRequestException("Invalid payment note type", "INVALID_PAYMENT_NOTE_TYPE");
        }

        String priority = StringUtils.hasText(request.getPriority())
                ? request.getPriority().trim().toUpperCase()
                : DEFAULT_PRIORITY;
        if (!VALID_PRIORITIES.contains(priority)) {
            throw new BadRequestException("Invalid payment note priority", "INVALID_PAYMENT_NOTE_PRIORITY");
        }

        paymentNote.setContact(contact);
        paymentNote.setSale(sale);
        paymentNote.setPayment(payment);
        paymentNote.setNoteType(noteType);
        paymentNote.setSubject(request.getSubject());
        paymentNote.setDescription(request.getDescription());
        paymentNote.setAmount(request.getAmount() == null ? null : support.money(request.getAmount()));
        paymentNote.setPriority(priority);
        paymentNote.setAssignedTo(request.getAssignedToId() == null ? null : support.getActiveUser(request.getAssignedToId()));
    }

    private String nextNoteNo(Long organizationId) {
        String currentNumber = paymentNoteRepository
                .findTopByNoteNoStartingWithAndOrganizationIdOrderByIdDesc(NOTE_PREFIX, organizationId)
                .map(PaymentNote::getNoteNo)
                .orElse(null);
        return support.nextNumber(NOTE_PREFIX, currentNumber);
    }

    private void logFieldChange(PaymentNote paymentNote, String fieldName, String oldValue, String newValue) {
        if (Objects.equals(oldValue, newValue)) {
            return;
        }
        writeAudit(paymentNote, ACTION_UPDATED, fieldName, oldValue, newValue);
    }

    private void writeAudit(PaymentNote paymentNote, String action, String fieldName, String oldValue, String newValue) {
        paymentNoteAuditRepository.save(PaymentNoteAudit.builder()
                .organization(paymentNote.getOrganization())
                .paymentNote(paymentNote)
                .action(action)
                .fieldName(fieldName)
                .oldValue(oldValue)
                .newValue(newValue)
                .build());
    }

    private PaymentNote getPaymentNote(Long id) {
        return paymentNoteRepository.findByIdAndOrganizationIdAndIsDeletedFalse(
                        id,
                        currentOrganizationService.getOrganizationId()
                )
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.PAYMENT_NOTE_NOT_FOUND, "PAYMENT_NOTE_NOT_FOUND"));
    }

    private PaymentNoteListResponseDto toListResponse(PaymentNote paymentNote) {
        return PaymentNoteListResponseDto.builder()
                .paymentNoteId(paymentNote.getId())
                .noteNo(paymentNote.getNoteNo())
                .subject(paymentNote.getSubject())
                .contactName(support.contactDisplayName(paymentNote.getContact()))
                .noteType(paymentNote.getNoteType())
                .priority(paymentNote.getPriority())
                .status(paymentNote.getStatus())
                .amount(paymentNote.getAmount())
                .assignedToName(userDisplayName(paymentNote.getAssignedTo()))
                .createdAt(paymentNote.getCreatedAt())
                .build();
    }

    private PaymentNoteDetailResponseDto toDetailResponse(PaymentNote paymentNote) {
        return PaymentNoteDetailResponseDto.builder()
                .paymentNoteId(paymentNote.getId())
                .noteNo(paymentNote.getNoteNo())
                .contact(support.toNameId(paymentNote.getContact()))
                .sale(toSaleNameId(paymentNote.getSale()))
                .payment(toPaymentNameId(paymentNote.getPayment()))
                .noteType(paymentNote.getNoteType())
                .subject(paymentNote.getSubject())
                .description(paymentNote.getDescription())
                .amount(paymentNote.getAmount())
                .priority(paymentNote.getPriority())
                .status(paymentNote.getStatus())
                .assignedTo(toUserNameId(paymentNote.getAssignedTo()))
                .resolutionNotes(paymentNote.getResolutionNotes())
                .resolvedAt(paymentNote.getResolvedAt())
                .createdAt(paymentNote.getCreatedAt())
                .createdBy(paymentNote.getCreatedBy())
                .build();
    }

    private PaymentNoteAuditResponseDto toAuditResponse(PaymentNoteAudit audit) {
        return PaymentNoteAuditResponseDto.builder()
                .action(audit.getAction())
                .fieldName(audit.getFieldName())
                .oldValue(audit.getOldValue())
                .newValue(audit.getNewValue())
                .performedBy(audit.getCreatedBy())
                .performedAt(audit.getCreatedAt())
                .build();
    }

    private NameIdResponseDto toSaleNameId(Sale sale) {
        return sale == null ? null : NameIdResponseDto.builder().id(sale.getId()).name(sale.getInvoiceNo()).build();
    }

    private NameIdResponseDto toPaymentNameId(Payment payment) {
        return payment == null ? null : NameIdResponseDto.builder().id(payment.getId()).name(payment.getPaymentNo()).build();
    }

    private NameIdResponseDto toUserNameId(User user) {
        return user == null ? null : NameIdResponseDto.builder().id(user.getId()).name(userDisplayName(user)).build();
    }

    private String userDisplayName(User user) {
        return user == null ? null : (user.getFirstName() + " " + user.getLastName()).trim();
    }
}
