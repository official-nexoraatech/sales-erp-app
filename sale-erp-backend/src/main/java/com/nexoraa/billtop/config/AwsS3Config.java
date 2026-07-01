package com.nexoraa.billtop.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.util.StringUtils;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.AwsCredentialsProvider;
import software.amazon.awssdk.auth.credentials.AwsSessionCredentials;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;

@Configuration
@EnableConfigurationProperties(AwsS3Properties.class)
public class AwsS3Config {

    @Bean(destroyMethod = "close")
    public S3Client s3Client(AwsS3Properties properties) {
        return S3Client.builder()
                .region(Region.of(properties.getRegion()))
                .credentialsProvider(credentialsProvider(properties))
                .build();
    }

    private AwsCredentialsProvider credentialsProvider(AwsS3Properties properties) {
        boolean hasAccessKey = StringUtils.hasText(properties.getAccessKeyId());
        boolean hasSecretKey = StringUtils.hasText(properties.getSecretAccessKey());
        if (hasAccessKey != hasSecretKey) {
            throw new IllegalStateException("Both AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be configured for S3 uploads");
        }
        if (!hasAccessKey) {
            return DefaultCredentialsProvider.builder().build();
        }
        if (StringUtils.hasText(properties.getSessionToken())) {
            return StaticCredentialsProvider.create(AwsSessionCredentials.create(
                    properties.getAccessKeyId().trim(),
                    properties.getSecretAccessKey().trim(),
                    properties.getSessionToken().trim()
            ));
        }
        return StaticCredentialsProvider.create(AwsBasicCredentials.create(
                properties.getAccessKeyId().trim(),
                properties.getSecretAccessKey().trim()
        ));
    }
}
