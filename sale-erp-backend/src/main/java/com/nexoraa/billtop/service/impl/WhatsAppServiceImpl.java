package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.common.FileUploadResponseDto;
import com.nexoraa.billtop.dto.whatsapp.WhatsAppSendDocumentRequestDto;
import com.nexoraa.billtop.entity.Contact;
import com.nexoraa.billtop.entity.Sale;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.repository.SaleRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.FileStorageService;
import com.nexoraa.billtop.service.PosInvoicePdfService;
import com.nexoraa.billtop.service.WhatsAppService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Service
public class WhatsAppServiceImpl implements WhatsAppService {

    private static final Logger LOGGER = LoggerFactory.getLogger(WhatsAppServiceImpl.class);
    private static final String MOBILE_PATTERN = "^\\+?[0-9]{10,15}$";

    private static final String INVOICE_UPLOAD_FOLDER = "invoices/whatsapp";

    private final SaleRepository saleRepository;
    private final CurrentOrganizationService currentOrganizationService;
    private final PosInvoicePdfService posInvoicePdfService;
    private final FileStorageService fileStorageService;
    private final String apiBaseUrl;
    private final String apiKey;
    private final String invoiceTemplateName;
    private final String documentHeaderParamName;

    public WhatsAppServiceImpl(
            SaleRepository saleRepository,
            CurrentOrganizationService currentOrganizationService,
            PosInvoicePdfService posInvoicePdfService,
            FileStorageService fileStorageService,
            @Value("${app.whatsapp.api-base-url:}") String apiBaseUrl,
            @Value("${app.whatsapp.api-key:}") String apiKey,
            @Value("${app.whatsapp.invoice-template-name:}") String invoiceTemplateName,
            @Value("${app.whatsapp.document-header-param-name:document}") String documentHeaderParamName
    ) {
        this.saleRepository = saleRepository;
        this.currentOrganizationService = currentOrganizationService;
        this.posInvoicePdfService = posInvoicePdfService;
        this.fileStorageService = fileStorageService;
        this.apiBaseUrl = apiBaseUrl;
        this.apiKey = apiKey;
        this.invoiceTemplateName = invoiceTemplateName;
        this.documentHeaderParamName = documentHeaderParamName;
    }

    @Override
    public void sendDocument(WhatsAppSendDocumentRequestDto request) {
        List<String> mobileNumbers = request.getMobileNumbers().stream()
                .map(String::trim)
                .filter(StringUtils::hasText)
                .distinct()
                .toList();

        if (mobileNumbers.isEmpty() || mobileNumbers.stream().anyMatch(number -> !number.matches(MOBILE_PATTERN))) {
            throw new BadRequestException(ErrorMessage.INVALID_WHATSAPP_NUMBERS, "INVALID_WHATSAPP_NUMBERS");
        }

        if (!StringUtils.hasText(invoiceTemplateName)) {
            throw new BadRequestException(ErrorMessage.WHATSAPP_TEMPLATE_NOT_CONFIGURED, "WHATSAPP_TEMPLATE_NOT_CONFIGURED");
        }

        if (!StringUtils.hasText(apiBaseUrl)) {
            LOGGER.info("WhatsApp send requested for {} recipient(s); no WhatsApp provider configured", mobileNumbers.size());
            return;
        }

        List<Map<String, String>> parameters = new ArrayList<>();
        request.getTemplateParams().forEach((name, value) -> parameters.add(Map.of("name", name, "value", value)));
        parameters.add(Map.of("name", documentHeaderParamName, "value", request.getDocumentUrl()));

        String broadcastName = invoiceTemplateName + "_" + System.currentTimeMillis();

        for (String mobileNumber : mobileNumbers) {
            try {
                RestClient.create()
                        .post()
                        .uri(apiBaseUrl + "/sendTemplateMessage?whatsappNumber=" + mobileNumber)
                        .header("Authorization", "Bearer " + apiKey)
                        .body(Map.of(
                                "template_name", invoiceTemplateName,
                                "broadcast_name", broadcastName,
                                "parameters", parameters
                        ))
                        .retrieve()
                        .toBodilessEntity();
            } catch (RestClientException ex) {
                LOGGER.error("WhatsApp send failed for {}", mobileNumber, ex);
                throw new BadRequestException(ErrorMessage.WHATSAPP_SEND_FAILED, "WHATSAPP_SEND_FAILED");
            }
        }
    }

    @Override
    public void sendInvoice(Long saleId, String mobileNumberOverride) {
        Sale sale = saleRepository.findByIdAndOrganizationIdAndIsDeletedFalse(saleId, currentOrganizationService.getOrganizationId())
                .orElseThrow(() -> new ResourceNotFoundException(ErrorMessage.SALE_NOT_FOUND, "SALE_NOT_FOUND"));

        Contact customer = sale.getCustomer();
        String mobileNumber = StringUtils.hasText(mobileNumberOverride) ? mobileNumberOverride : resolveWhatsAppNumber(customer);

        if (!StringUtils.hasText(mobileNumber)) {
            throw new BadRequestException(ErrorMessage.WHATSAPP_NUMBER_NOT_FOUND, "WHATSAPP_NUMBER_NOT_FOUND");
        }

        PosInvoicePdfService.InvoicePdf invoicePdf = posInvoicePdfService.generateInvoicePdf(saleId);
        FileUploadResponseDto uploaded = fileStorageService.uploadFile(
                invoicePdf.content(), invoicePdf.fileName(), MediaType.APPLICATION_PDF_VALUE, INVOICE_UPLOAD_FOLDER
        );

        sendDocument(WhatsAppSendDocumentRequestDto.builder()
                .mobileNumbers(List.of(mobileNumber))
                .documentUrl(uploaded.getObjectUrl())
                .fileName(invoicePdf.fileName())
                .templateParams(Map.of(
                        "1","Dipak",
                        "2", "1010101"
                ))
                .build());
    }

    private String resolveWhatsAppNumber(Contact customer) {
        if (customer == null) {
            return null;
        }
        return StringUtils.hasText(customer.getWhatsappNo()) ? customer.getWhatsappNo() : customer.getMobile();
    }
}
