package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.config.AwsS3Properties;
import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.common.FileUploadResponseDto;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.FileStorageException;
import com.nexoraa.billtop.service.FileStorageService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;
import software.amazon.awssdk.core.exception.SdkClientException;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;

import java.io.IOException;
import java.io.InputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Arrays;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;

@Service
public class S3FileStorageServiceImpl implements FileStorageService {

    private static final Logger log = LoggerFactory.getLogger(S3FileStorageServiceImpl.class);
    private static final int MAX_FILE_NAME_LENGTH = 150;

    private final S3Client s3Client;
    private final AwsS3Properties properties;

    public S3FileStorageServiceImpl(S3Client s3Client, AwsS3Properties properties) {
        this.s3Client = s3Client;
        this.properties = properties;
    }

    @Override
    public FileUploadResponseDto uploadImage(MultipartFile file, String folderPath) {
        validateImage(file);
        return upload(file, folderPath);
    }

    @Override
    public FileUploadResponseDto uploadFile(MultipartFile file, String folderPath) {
        validateFile(file);
        return upload(file, folderPath);
    }

    private FileUploadResponseDto upload(MultipartFile file, String folderPath) {
        String fileName = sanitizeFileName(file);
        String objectKey = normalizeFolderPath(folderPath) + "/" + fileName;
        String contentType = file.getContentType();

        PutObjectRequest request = PutObjectRequest.builder()
                .bucket(properties.getBucket())
                .key(objectKey)
                .contentType(contentType)
                .contentLength(file.getSize())
                .metadata(Map.of("original-filename", resolveOriginalFileName(file)))
                .build();

        try (InputStream inputStream = file.getInputStream()) {
            s3Client.putObject(request, RequestBody.fromInputStream(inputStream, file.getSize()));
        } catch (S3Exception ex) {
            log.error(
                    "S3 upload failed. bucket={}, key={}, statusCode={}, awsErrorCode={}, requestId={}, awsMessage={}",
                    properties.getBucket(),
                    objectKey,
                    ex.statusCode(),
                    resolveAwsErrorCode(ex),
                    ex.requestId(),
                    resolveAwsErrorMessage(ex),
                    ex
            );
            throw new FileStorageException(ErrorMessage.FILE_UPLOAD_FAILED, "FILE_UPLOAD_FAILED", ex);
        } catch (SdkClientException ex) {
            log.error(
                    "S3 client upload failed. bucket={}, key={}, message={}",
                    properties.getBucket(),
                    objectKey,
                    ex.getMessage(),
                    ex
            );
            throw new FileStorageException(ErrorMessage.FILE_UPLOAD_FAILED, "FILE_UPLOAD_FAILED", ex);
        } catch (IOException ex) {
            log.error(
                    "Failed to read upload file stream before S3 upload. bucket={}, key={}, originalFileName={}, message={}",
                    properties.getBucket(),
                    objectKey,
                    resolveOriginalFileName(file),
                    ex.getMessage(),
                    ex
            );
            throw new FileStorageException(ErrorMessage.FILE_UPLOAD_FAILED, "FILE_UPLOAD_FAILED", ex);
        }

        return FileUploadResponseDto.builder()
                .fileName(fileName)
                .objectKey(objectKey)
                .objectUrl(buildObjectUrl(objectKey))
                .contentType(contentType)
                .size(file.getSize())
                .build();
    }

    private void validateFile(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new BadRequestException(ErrorMessage.FILE_REQUIRED, "FILE_REQUIRED");
        }

        if (file.getSize() > properties.getMaxImageSize().toBytes()) {
            throw new BadRequestException(ErrorMessage.FILE_SIZE_EXCEEDED, "FILE_SIZE_EXCEEDED");
        }
    }

    private void validateImage(MultipartFile file) {
        validateFile(file);

        String contentType = file.getContentType();
        boolean allowedContentType = StringUtils.hasText(contentType)
                && properties.getAllowedContentTypes().stream()
                .map(allowed -> allowed.toLowerCase(Locale.ROOT))
                .anyMatch(allowed -> allowed.equals(contentType.toLowerCase(Locale.ROOT)));

        if (!allowedContentType) {
            throw new BadRequestException(ErrorMessage.INVALID_IMAGE_FILE, "INVALID_IMAGE_FILE");
        }
    }

    private String sanitizeFileName(MultipartFile file) {
        String originalFileName = resolveOriginalFileName(file);
        String fileName = originalFileName.replace('\\', '/');
        int lastSlash = fileName.lastIndexOf('/');
        if (lastSlash >= 0) {
            fileName = fileName.substring(lastSlash + 1);
        }

        fileName = StringUtils.cleanPath(fileName)
                .trim()
                .replaceAll("\\s+", "-")
                .replaceAll("[^A-Za-z0-9._-]", "-")
                .replaceAll("-+", "-")
                .replaceAll("^\\.+", "");

        if (!StringUtils.hasText(fileName)) {
            fileName = "file-" + Instant.now().toEpochMilli() + extensionFromContentType(file.getContentType());
        }

        if (!fileName.contains(".")) {
            fileName = fileName + extensionFromContentType(file.getContentType());
        }

        return truncateFileName(fileName);
    }

    private String truncateFileName(String fileName) {
        if (fileName.length() <= MAX_FILE_NAME_LENGTH) {
            return fileName;
        }

        int lastDot = fileName.lastIndexOf('.');
        if (lastDot <= 0) {
            return fileName.substring(0, MAX_FILE_NAME_LENGTH);
        }

        String extension = fileName.substring(lastDot);
        int baseLength = Math.max(1, MAX_FILE_NAME_LENGTH - extension.length());
        return fileName.substring(0, baseLength) + extension;
    }

    private String normalizeFolderPath(String folderPath) {
        if (!StringUtils.hasText(folderPath)) {
            throw new BadRequestException(ErrorMessage.BAD_REQUEST, "INVALID_FOLDER_PATH");
        }

        String normalized = folderPath.replace('\\', '/')
                .replaceAll("/+", "/")
                .replaceAll("^/+", "")
                .replaceAll("/+$", "");

        if (!StringUtils.hasText(normalized) || normalized.contains("..") || !normalized.matches("[A-Za-z0-9._/-]+")) {
            throw new BadRequestException(ErrorMessage.BAD_REQUEST, "INVALID_FOLDER_PATH");
        }

        return normalized;
    }

    private String buildObjectUrl(String objectKey) {
        String encodedKey = Arrays.stream(objectKey.split("/"))
                .map(segment -> URLEncoder.encode(segment, StandardCharsets.UTF_8).replace("+", "%20"))
                .collect(Collectors.joining("/"));
        return properties.getPublicUrl().replaceAll("/+$", "") + "/" + encodedKey;
    }

    private String resolveOriginalFileName(MultipartFile file) {
        String originalFilename = file.getOriginalFilename();
        return StringUtils.hasText(originalFilename) ? originalFilename : "file";
    }

    private String extensionFromContentType(String contentType) {
        if ("image/png".equalsIgnoreCase(contentType)) {
            return ".png";
        }
        if ("image/webp".equalsIgnoreCase(contentType)) {
            return ".webp";
        }
        if ("application/pdf".equalsIgnoreCase(contentType)) {
            return ".pdf";
        }
        if ("text/plain".equalsIgnoreCase(contentType)) {
            return ".txt";
        }
        if ("application/msword".equalsIgnoreCase(contentType)) {
            return ".doc";
        }
        if ("application/vnd.openxmlformats-officedocument.wordprocessingml.document".equalsIgnoreCase(contentType)) {
            return ".docx";
        }
        return StringUtils.hasText(contentType) && contentType.toLowerCase(Locale.ROOT).startsWith("image/") ? ".jpg" : ".bin";
    }

    private String resolveAwsErrorCode(S3Exception ex) {
        return ex.awsErrorDetails() == null ? "UNKNOWN" : ex.awsErrorDetails().errorCode();
    }

    private String resolveAwsErrorMessage(S3Exception ex) {
        return ex.awsErrorDetails() == null ? ex.getMessage() : ex.awsErrorDetails().errorMessage();
    }
}
