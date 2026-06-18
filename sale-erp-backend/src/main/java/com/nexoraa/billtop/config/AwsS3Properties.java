package com.nexoraa.billtop.config;

import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.util.unit.DataSize;
import org.springframework.validation.annotation.Validated;

import java.util.List;

@Getter
@Setter
@Validated
@ConfigurationProperties(prefix = "app.aws.s3")
public class AwsS3Properties {

    @NotBlank
    private String bucket;

    @NotBlank
    private String region = "ap-south-1";

    @NotBlank
    private String publicUrl;

    private DataSize maxImageSize = DataSize.ofMegabytes(5);

    private List<String> allowedContentTypes = List.of(
            "image/jpeg",
            "image/png",
            "image/webp"
    );
}
