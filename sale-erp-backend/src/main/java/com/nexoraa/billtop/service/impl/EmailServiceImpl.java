package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.email.EmailTemplateRequestDto;
import com.nexoraa.billtop.dto.email.EmailTemplateResponseDto;
import com.nexoraa.billtop.entity.EmailTemplate;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.mapper.EmailTemplateMapper;
import com.nexoraa.billtop.repository.EmailTemplateRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.EmailService;
import jakarta.mail.MessagingException;
import jakarta.mail.internet.AddressException;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.mail.MailException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

import java.util.Arrays;
import java.util.List;

@Service
public class EmailServiceImpl implements EmailService {

    private final EmailTemplateRepository emailTemplateRepository;
    private final EmailTemplateMapper emailTemplateMapper;
    private final CurrentOrganizationService currentOrganizationService;
    private final JavaMailSender mailSender;
    private final String fromAddress;

    public EmailServiceImpl(
            EmailTemplateRepository emailTemplateRepository,
            EmailTemplateMapper emailTemplateMapper,
            CurrentOrganizationService currentOrganizationService,
            JavaMailSender mailSender,
            @Value("${spring.mail.username:no-reply@billtop.com}") String fromAddress
    ) {
        this.emailTemplateRepository = emailTemplateRepository;
        this.emailTemplateMapper = emailTemplateMapper;
        this.currentOrganizationService = currentOrganizationService;
        this.mailSender = mailSender;
        this.fromAddress = fromAddress;
    }

    @Override
    @Transactional
    public void createTemplate(EmailTemplateRequestDto request) {
        Long organizationId = currentOrganizationService.getOrganizationId();
        if (emailTemplateRepository.existsByNameIgnoreCaseAndOrganizationIdAndStatus(request.getName(), organizationId, com.nexoraa.billtop.enums.Status.ACTIVE)) {
            throw new BadRequestException(ErrorMessage.EMAIL_TEMPLATE_ALREADY_EXISTS, "EMAIL_TEMPLATE_ALREADY_EXISTS");
        }
        EmailTemplate template = emailTemplateMapper.toEntity(request);
        template.setOrganization(currentOrganizationService.getOrganizationReference());
        emailTemplateRepository.save(template);
    }

    @Override
    @Transactional(readOnly = true)
    public PageResponseDto<EmailTemplateResponseDto> getTemplates(int page, int size, String search) {
        return PageResponseDto.from(emailTemplateRepository
                .findAll(activeTemplateSpecification(search), PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "id")))
                .map(emailTemplateMapper::toResponse));
    }

    @Override
    @Transactional(readOnly = true)
    public EmailTemplateResponseDto getTemplateById(Long id) {
        return emailTemplateMapper.toResponse(getActiveTemplate(id));
    }

    @Override
    @Transactional
    public void updateTemplate(Long id, EmailTemplateRequestDto request) {
        EmailTemplate template = getActiveTemplate(id);
        if (emailTemplateRepository.existsByNameIgnoreCaseAndIdNotAndOrganizationIdAndStatus(
                request.getName(),
                id,
                currentOrganizationService.getOrganizationId(),
                com.nexoraa.billtop.enums.Status.ACTIVE
        )) {
            throw new BadRequestException(ErrorMessage.EMAIL_TEMPLATE_ALREADY_EXISTS, "EMAIL_TEMPLATE_ALREADY_EXISTS");
        }
        emailTemplateMapper.updateEntity(request, template);
        emailTemplateRepository.save(template);
    }

    @Override
    @Transactional
    public void deleteTemplate(Long id) {
        EmailTemplate template = getActiveTemplate(id);
        template.setStatus(com.nexoraa.billtop.enums.Status.INACTIVE);
        emailTemplateRepository.save(template);
    }

    @Override
    public void sendEmail(String emailIds, String subject, String message, MultipartFile file) {
        List<String> recipients = parseRecipients(emailIds);
        if (!StringUtils.hasText(subject) || !StringUtils.hasText(message)) {
            throw new BadRequestException(ErrorMessage.BAD_REQUEST, "BAD_REQUEST");
        }

        try {
            MimeMessage mimeMessage = mailSender.createMimeMessage();
            boolean hasAttachment = file != null && !file.isEmpty();
            MimeMessageHelper helper = new MimeMessageHelper(mimeMessage, hasAttachment);
            helper.setFrom(fromAddress);
            helper.setTo(recipients.toArray(String[]::new));
            helper.setSubject(subject.trim());
            helper.setText(message, false);

            if (hasAttachment) {
                String fileName = StringUtils.hasText(file.getOriginalFilename())
                        ? file.getOriginalFilename()
                        : "attachment";
                helper.addAttachment(fileName, file);
            }

            mailSender.send(mimeMessage);
        } catch (MessagingException | MailException ex) {
            throw new BadRequestException(ErrorMessage.EMAIL_SEND_FAILED, "EMAIL_SEND_FAILED");
        }
    }

    private EmailTemplate getActiveTemplate(Long id) {
        return emailTemplateRepository.findByIdAndOrganizationIdAndStatus(
                        id,
                        currentOrganizationService.getOrganizationId(),
                        com.nexoraa.billtop.enums.Status.ACTIVE
                )
                .orElseThrow(() -> new ResourceNotFoundException(
                        ErrorMessage.EMAIL_TEMPLATE_NOT_FOUND,
                        "EMAIL_TEMPLATE_NOT_FOUND"
                ));
    }

    private Specification<EmailTemplate> activeTemplateSpecification(String search) {
        Long organizationId = currentOrganizationService.getOrganizationId();
        Specification<EmailTemplate> specification = (root, query, criteriaBuilder) -> criteriaBuilder.and(
                criteriaBuilder.equal(root.get("organization").get("id"), organizationId),
                criteriaBuilder.equal(root.get("status"), com.nexoraa.billtop.enums.Status.ACTIVE)
        );

        if (!StringUtils.hasText(search)) {
            return specification;
        }

        String pattern = "%" + search.trim().toLowerCase() + "%";
        return specification.and((root, query, criteriaBuilder) -> criteriaBuilder.or(
                criteriaBuilder.like(criteriaBuilder.lower(root.get("name")), pattern),
                criteriaBuilder.like(criteriaBuilder.lower(root.get("subject")), pattern),
                criteriaBuilder.like(criteriaBuilder.lower(root.get("content")), pattern)
        ));
    }

    private List<String> parseRecipients(String emailIds) {
        if (!StringUtils.hasText(emailIds)) {
            throw new BadRequestException(ErrorMessage.INVALID_EMAIL_IDS, "INVALID_EMAIL_IDS");
        }

        List<String> recipients = Arrays.stream(emailIds.split(","))
                .map(String::trim)
                .filter(StringUtils::hasText)
                .distinct()
                .toList();

        if (recipients.isEmpty()) {
            throw new BadRequestException(ErrorMessage.INVALID_EMAIL_IDS, "INVALID_EMAIL_IDS");
        }

        for (String recipient : recipients) {
            validateEmail(recipient);
        }

        return recipients;
    }

    private void validateEmail(String email) {
        try {
            InternetAddress internetAddress = new InternetAddress(email);
            internetAddress.validate();
        } catch (AddressException ex) {
            throw new BadRequestException(ErrorMessage.INVALID_EMAIL_IDS, "INVALID_EMAIL_IDS");
        }
    }
}



