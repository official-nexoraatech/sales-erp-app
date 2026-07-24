package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.paymentnote.PaymentNoteAssignDto;
import com.nexoraa.billtop.dto.paymentnote.PaymentNoteAuditResponseDto;
import com.nexoraa.billtop.dto.paymentnote.PaymentNoteDetailResponseDto;
import com.nexoraa.billtop.dto.paymentnote.PaymentNoteListResponseDto;
import com.nexoraa.billtop.dto.paymentnote.PaymentNoteRequestDto;
import com.nexoraa.billtop.dto.paymentnote.PaymentNoteStatusUpdateDto;

import java.time.LocalDate;
import java.util.List;

public interface PaymentNoteService {

    PaymentNoteDetailResponseDto createPaymentNote(PaymentNoteRequestDto request);

    PageResponseDto<PaymentNoteListResponseDto> getPaymentNotes(
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
    );

    PaymentNoteDetailResponseDto getPaymentNoteById(Long id);

    void updatePaymentNote(Long id, PaymentNoteRequestDto request);

    void updateStatus(Long id, PaymentNoteStatusUpdateDto request);

    void assign(Long id, PaymentNoteAssignDto request);

    void deletePaymentNote(Long id);

    List<PaymentNoteAuditResponseDto> getAuditTrail(Long id);
}
