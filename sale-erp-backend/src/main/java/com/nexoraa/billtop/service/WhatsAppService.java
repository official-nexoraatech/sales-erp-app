package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.whatsapp.WhatsAppSendDocumentRequestDto;

public interface WhatsAppService {

    void sendDocument(WhatsAppSendDocumentRequestDto request);

    void sendInvoice(Long saleId, String mobileNumberOverride);
}
