package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.sms.SmsSendRequestDto;
import com.nexoraa.billtop.dto.sms.SmsTemplateRequestDto;
import com.nexoraa.billtop.dto.sms.SmsTemplateResponseDto;
import com.nexoraa.billtop.entity.SmsTemplate;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.mapper.SmsTemplateMapper;
import com.nexoraa.billtop.repository.SmsTemplateRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.SmsService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.util.List;
import java.util.Map;

@Service
public class SmsServiceImpl implements SmsService {

    private static final Logger LOGGER = LoggerFactory.getLogger(SmsServiceImpl.class);
    private static final String MOBILE_PATTERN = "^\\+?[0-9]{10,15}$";

    private final SmsTemplateRepository smsTemplateRepository;
    private final SmsTemplateMapper smsTemplateMapper;
    private final CurrentOrganizationService currentOrganizationService;
    private final String smsProviderUrl;
    private final String smsApiKey;

    public SmsServiceImpl(
            SmsTemplateRepository smsTemplateRepository,
            SmsTemplateMapper smsTemplateMapper,
            CurrentOrganizationService currentOrganizationService,
            @Value("${app.sms.provider-url:}") String smsProviderUrl,
            @Value("${app.sms.api-key:}") String smsApiKey
    ) {
        this.smsTemplateRepository = smsTemplateRepository;
        this.smsTemplateMapper = smsTemplateMapper;
        this.currentOrganizationService = currentOrganizationService;
        this.smsProviderUrl = smsProviderUrl;
        this.smsApiKey = smsApiKey;
    }

    @Override
    @Transactional
    public void createTemplate(SmsTemplateRequestDto request) {
        Long organizationId = currentOrganizationService.getOrganizationId();
        if (smsTemplateRepository.existsByNameIgnoreCaseAndOrganizationIdAndStatus(request.getName(), organizationId, com.nexoraa.billtop.enums.Status.ACTIVE)) {
            throw new BadRequestException(ErrorMessage.SMS_TEMPLATE_ALREADY_EXISTS, "SMS_TEMPLATE_ALREADY_EXISTS");
        }
        SmsTemplate template = smsTemplateMapper.toEntity(request);
        template.setOrganization(currentOrganizationService.getOrganizationReference());
        smsTemplateRepository.save(template);
    }

    @Override
    @Transactional(readOnly = true)
    public PageResponseDto<SmsTemplateResponseDto> getTemplates(int page, int size, String search) {
        return PageResponseDto.from(smsTemplateRepository
                .findAll(activeTemplateSpecification(search), PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "id")))
                .map(smsTemplateMapper::toResponse));
    }

    @Override
    @Transactional(readOnly = true)
    public SmsTemplateResponseDto getTemplateById(Long id) {
        return smsTemplateMapper.toResponse(getActiveTemplate(id));
    }

    @Override
    @Transactional
    public void updateTemplate(Long id, SmsTemplateRequestDto request) {
        SmsTemplate template = getActiveTemplate(id);
        if (smsTemplateRepository.existsByNameIgnoreCaseAndIdNotAndOrganizationIdAndStatus(
                request.getName(),
                id,
                currentOrganizationService.getOrganizationId(),
                com.nexoraa.billtop.enums.Status.ACTIVE
        )) {
            throw new BadRequestException(ErrorMessage.SMS_TEMPLATE_ALREADY_EXISTS, "SMS_TEMPLATE_ALREADY_EXISTS");
        }
        smsTemplateMapper.updateEntity(request, template);
        smsTemplateRepository.save(template);
    }

    @Override
    @Transactional
    public void deleteTemplate(Long id) {
        SmsTemplate template = getActiveTemplate(id);
        template.setStatus(com.nexoraa.billtop.enums.Status.INACTIVE);
        smsTemplateRepository.save(template);
    }

    @Override
    public void sendSms(SmsSendRequestDto request) {
        List<String> mobileNumbers = request.getMobileNumbers().stream()
                .map(String::trim)
                .filter(StringUtils::hasText)
                .distinct()
                .toList();

        if (mobileNumbers.isEmpty() || mobileNumbers.stream().anyMatch(number -> !number.matches(MOBILE_PATTERN))) {
            throw new BadRequestException(ErrorMessage.INVALID_MOBILE_NUMBERS, "INVALID_MOBILE_NUMBERS");
        }

        if (!StringUtils.hasText(smsProviderUrl)) {
            LOGGER.info("SMS send requested for {} recipient(s); no SMS provider URL configured", mobileNumbers.size());
            return;
        }

        try {
            RestClient.RequestBodySpec requestSpec = RestClient.create()
                    .post()
                    .uri(smsProviderUrl);
            if (StringUtils.hasText(smsApiKey)) {
                requestSpec.header("Authorization", "Bearer " + smsApiKey);
            }
            requestSpec
                    .body(Map.of(
                            "mobileNumbers", mobileNumbers,
                            "message", request.getMessage().trim()
                    ))
                    .retrieve()
                    .toBodilessEntity();
        } catch (RestClientException ex) {
            throw new BadRequestException(ErrorMessage.SMS_SEND_FAILED, "SMS_SEND_FAILED");
        }
    }

    private SmsTemplate getActiveTemplate(Long id) {
        return smsTemplateRepository.findByIdAndOrganizationIdAndStatus(
                        id,
                        currentOrganizationService.getOrganizationId(),
                        com.nexoraa.billtop.enums.Status.ACTIVE
                )
                .orElseThrow(() -> new ResourceNotFoundException(
                        ErrorMessage.SMS_TEMPLATE_NOT_FOUND,
                        "SMS_TEMPLATE_NOT_FOUND"
                ));
    }

    private Specification<SmsTemplate> activeTemplateSpecification(String search) {
        Long organizationId = currentOrganizationService.getOrganizationId();
        Specification<SmsTemplate> specification = (root, query, criteriaBuilder) -> criteriaBuilder.and(
                criteriaBuilder.equal(root.get("organization").get("id"), organizationId),
                criteriaBuilder.equal(root.get("status"), com.nexoraa.billtop.enums.Status.ACTIVE)
        );

        if (!StringUtils.hasText(search)) {
            return specification;
        }

        String pattern = "%" + search.trim().toLowerCase() + "%";
        return specification.and((root, query, criteriaBuilder) -> criteriaBuilder.or(
                criteriaBuilder.like(criteriaBuilder.lower(root.get("name")), pattern),
                criteriaBuilder.like(criteriaBuilder.lower(root.get("content")), pattern)
        ));
    }
}



