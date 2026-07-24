package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.paymentnote.PaymentNoteAssignDto;
import com.nexoraa.billtop.dto.paymentnote.PaymentNoteAuditResponseDto;
import com.nexoraa.billtop.dto.paymentnote.PaymentNoteDetailResponseDto;
import com.nexoraa.billtop.dto.paymentnote.PaymentNoteListResponseDto;
import com.nexoraa.billtop.dto.paymentnote.PaymentNoteRequestDto;
import com.nexoraa.billtop.dto.paymentnote.PaymentNoteStatusUpdateDto;
import com.nexoraa.billtop.service.PaymentNoteService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Positive;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;

@Validated
@RestController
@RequestMapping("/api/v1/payment-notes")
public class PaymentNoteController {

    private final PaymentNoteService paymentNoteService;

    public PaymentNoteController(PaymentNoteService paymentNoteService) {
        this.paymentNoteService = paymentNoteService;
    }

    @PostMapping
    public ResponseEntity<ApiResponseDto<PaymentNoteDetailResponseDto>> createPaymentNote(
            @Valid @RequestBody PaymentNoteRequestDto request
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.PAYMENT_NOTE_CREATED,
                paymentNoteService.createPaymentNote(request)
        ));
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<PageResponseDto<PaymentNoteListResponseDto>>> getPaymentNotes(
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Positive int size,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fromDate,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate toDate,
            @RequestParam(required = false) List<String> status,
            @RequestParam(required = false) List<String> priority,
            @RequestParam(required = false) List<String> noteType,
            @RequestParam(required = false) Long contactId,
            @RequestParam(required = false) Long assignedToId
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.PAYMENT_NOTES_RETRIEVED,
                paymentNoteService.getPaymentNotes(
                        page, size, search, fromDate, toDate, status, priority, noteType, contactId, assignedToId
                )
        ));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponseDto<PaymentNoteDetailResponseDto>> getPaymentNoteById(@PathVariable @Positive Long id) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.PAYMENT_NOTE_RETRIEVED,
                paymentNoteService.getPaymentNoteById(id)
        ));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> updatePaymentNote(
            @PathVariable @Positive Long id,
            @Valid @RequestBody PaymentNoteRequestDto request
    ) {
        paymentNoteService.updatePaymentNote(id, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.PAYMENT_NOTE_UPDATED));
    }

    @PutMapping("/{id}/status")
    public ResponseEntity<ApiResponseDto<Void>> updateStatus(
            @PathVariable @Positive Long id,
            @Valid @RequestBody PaymentNoteStatusUpdateDto request
    ) {
        paymentNoteService.updateStatus(id, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.PAYMENT_NOTE_STATUS_UPDATED));
    }

    @PutMapping("/{id}/assign")
    public ResponseEntity<ApiResponseDto<Void>> assign(
            @PathVariable @Positive Long id,
            @Valid @RequestBody PaymentNoteAssignDto request
    ) {
        paymentNoteService.assign(id, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.PAYMENT_NOTE_ASSIGNED));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> deletePaymentNote(@PathVariable @Positive Long id) {
        paymentNoteService.deletePaymentNote(id);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.PAYMENT_NOTE_DELETED));
    }

    @GetMapping("/{id}/audit")
    public ResponseEntity<ApiResponseDto<List<PaymentNoteAuditResponseDto>>> getAuditTrail(@PathVariable @Positive Long id) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.PAYMENT_NOTE_AUDIT_RETRIEVED,
                paymentNoteService.getAuditTrail(id)
        ));
    }
}
