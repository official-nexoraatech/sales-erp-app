package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.email.ConnectEmailAccountRequestDto;
import com.nexoraa.billtop.dto.email.EmailAccountResponseDto;
import com.nexoraa.billtop.entity.UserEmailAccount;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.repository.UserEmailAccountRepository;
import com.nexoraa.billtop.security.CredentialEncryptionService;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.security.CurrentUserService;
import com.nexoraa.billtop.service.EmailAccountService;
import com.nexoraa.billtop.service.UserMailSenderFactory;
import jakarta.mail.MessagingException;
import jakarta.mail.internet.MimeMessage;
import org.springframework.mail.MailException;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;

@Service
public class EmailAccountServiceImpl implements EmailAccountService {

    private final UserEmailAccountRepository userEmailAccountRepository;
    private final CurrentUserService currentUserService;
    private final CurrentOrganizationService currentOrganizationService;
    private final CredentialEncryptionService credentialEncryptionService;
    private final UserMailSenderFactory userMailSenderFactory;

    public EmailAccountServiceImpl(
            UserEmailAccountRepository userEmailAccountRepository,
            CurrentUserService currentUserService,
            CurrentOrganizationService currentOrganizationService,
            CredentialEncryptionService credentialEncryptionService,
            UserMailSenderFactory userMailSenderFactory
    ) {
        this.userEmailAccountRepository = userEmailAccountRepository;
        this.currentUserService = currentUserService;
        this.currentOrganizationService = currentOrganizationService;
        this.credentialEncryptionService = credentialEncryptionService;
        this.userMailSenderFactory = userMailSenderFactory;
    }

    @Override
    @Transactional
    public EmailAccountResponseDto connect(ConnectEmailAccountRequestDto request) {
        verifySmtpCredentials(request);

        Long userId = currentUserService.getUserId();
        UserEmailAccount account = userEmailAccountRepository.findByUserIdAndIsDeletedFalse(userId)
                .orElseGet(UserEmailAccount::new);

        account.setUser(currentUserService.getUserReference());
        account.setOrganization(currentOrganizationService.getOrganizationReference());
        account.setFromAddress(request.getFromAddress().trim());
        account.setSmtpHost(request.getSmtpHost().trim());
        account.setSmtpPort(request.getSmtpPort());
        account.setSmtpUsername(request.getSmtpUsername().trim());
        account.setSmtpPasswordEncrypted(credentialEncryptionService.encrypt(request.getSmtpPassword()));
        account.setUseStarttls(request.isUseStarttls());
        account.setUseSsl(request.isUseSsl());
        account.setVerified(true);

        return toResponse(userEmailAccountRepository.save(account));
    }

    @Override
    @Transactional(readOnly = true)
    public EmailAccountResponseDto getMyAccount() {
        return userEmailAccountRepository.findByUserIdAndIsDeletedFalse(currentUserService.getUserId())
                .map(this::toResponse)
                .orElse(null);
    }

    @Override
    @Transactional
    public void disconnect() {
        userEmailAccountRepository.findByUserIdAndIsDeletedFalse(currentUserService.getUserId())
                .ifPresent(account -> {
                    account.setIsDeleted(true);
                    userEmailAccountRepository.save(account);
                });
    }

    private void verifySmtpCredentials(ConnectEmailAccountRequestDto request) {
        JavaMailSenderImpl sender = userMailSenderFactory.create(
                request.getSmtpHost().trim(),
                request.getSmtpPort(),
                request.getSmtpUsername().trim(),
                request.getSmtpPassword(),
                request.isUseStarttls(),
                request.isUseSsl()
        );

        try {
            MimeMessage mimeMessage = sender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(mimeMessage, StandardCharsets.UTF_8.name());
            helper.setFrom(request.getFromAddress().trim());
            helper.setTo(request.getFromAddress().trim());
            helper.setSubject("TexMitra email account connected");
            helper.setText(
                    "This confirms " + request.getFromAddress().trim()
                            + " is now connected to send emails from TexMitra.",
                    false
            );
            sender.send(mimeMessage);
        } catch (MessagingException | MailException ex) {
            throw new BadRequestException(
                    ErrorMessage.EMAIL_ACCOUNT_CONNECTION_FAILED,
                    "EMAIL_ACCOUNT_CONNECTION_FAILED",
                    ex
            );
        }
    }

    private EmailAccountResponseDto toResponse(UserEmailAccount account) {
        return EmailAccountResponseDto.builder()
                .id(account.getId())
                .fromAddress(account.getFromAddress())
                .smtpHost(account.getSmtpHost())
                .smtpPort(account.getSmtpPort())
                .smtpUsername(account.getSmtpUsername())
                .useStarttls(Boolean.TRUE.equals(account.getUseStarttls()))
                .useSsl(Boolean.TRUE.equals(account.getUseSsl()))
                .verified(Boolean.TRUE.equals(account.getVerified()))
                .build();
    }
}
