package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.contact.excel.ContactExcelImportResponseDto;
import com.nexoraa.billtop.service.ContactExcelService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@Validated
@RestController
@RequestMapping("/api/v1/contacts")
public class ContactExcelController {

    private final ContactExcelService contactExcelService;

    public ContactExcelController(ContactExcelService contactExcelService) {
        this.contactExcelService = contactExcelService;
    }

    @GetMapping("/excel/template")
    public ResponseEntity<byte[]> downloadContactImportTemplate() {
        byte[] file = contactExcelService.generateTemplate();
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + ContactExcelService.TEMPLATE_FILE_NAME + "\"")
                .contentType(MediaType.parseMediaType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
                .body(file);
    }

    @PostMapping(value = "/excel/import", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<ApiResponseDto<ContactExcelImportResponseDto>> importContactsFromExcel(
            @RequestParam MultipartFile file
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                "Contacts imported successfully",
                contactExcelService.importContacts(file)
        ));
    }
}
