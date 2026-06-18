package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.common.FileUploadResponseDto;
import org.springframework.web.multipart.MultipartFile;

public interface FileStorageService {

    FileUploadResponseDto uploadImage(MultipartFile file, String folderPath);

    FileUploadResponseDto uploadFile(MultipartFile file, String folderPath);
}
