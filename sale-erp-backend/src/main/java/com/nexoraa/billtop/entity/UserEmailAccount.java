package com.nexoraa.billtop.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "user_email_accounts")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class UserEmailAccount extends BaseEntity {

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "organization_id", nullable = false)
    private Organization organization;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Column(name = "from_address", nullable = false, length = 255)
    private String fromAddress;

    @Column(name = "smtp_host", nullable = false, length = 255)
    private String smtpHost;

    @Column(name = "smtp_port", nullable = false)
    private Integer smtpPort;

    @Column(name = "smtp_username", nullable = false, length = 255)
    private String smtpUsername;

    @Column(name = "smtp_password_encrypted", nullable = false, columnDefinition = "text")
    private String smtpPasswordEncrypted;

    @Builder.Default
    @Column(name = "use_starttls", nullable = false)
    private Boolean useStarttls = true;

    @Builder.Default
    @Column(name = "use_ssl", nullable = false)
    private Boolean useSsl = false;

    @Builder.Default
    @Column(nullable = false)
    private Boolean verified = false;
}
