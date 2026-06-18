package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.staff.EmployeeDocumentResponseDto;
import com.nexoraa.billtop.dto.staff.EmployeeRequestDto;
import com.nexoraa.billtop.dto.staff.EmployeeResponseDto;
import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.service.StaffEmployeeService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Positive;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

@Validated
@RestController
@RequestMapping("/api/v1/staff/employees")
public class StaffEmployeeController {

    private final StaffEmployeeService employeeService;

    public StaffEmployeeController(StaffEmployeeService employeeService) {
        this.employeeService = employeeService;
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<PageResponseDto<EmployeeResponseDto>>> getEmployees(
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Positive int size,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String department
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.STAFF_EMPLOYEES_RETRIEVED,
                employeeService.getEmployees(page, size, search, parseStatus(status), department)
        ));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponseDto<EmployeeResponseDto>> getEmployeeById(@PathVariable @Positive Long id) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.STAFF_EMPLOYEE_RETRIEVED,
                employeeService.getEmployeeById(id)
        ));
    }

    @PostMapping
    public ResponseEntity<ApiResponseDto<Void>> createEmployee(@Valid @RequestBody EmployeeRequestDto request) {
        employeeService.createEmployee(request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.STAFF_EMPLOYEE_CREATED));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> updateEmployee(
            @PathVariable @Positive Long id,
            @Valid @RequestBody EmployeeRequestDto request
    ) {
        employeeService.updateEmployee(id, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.STAFF_EMPLOYEE_UPDATED));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> deleteEmployee(@PathVariable @Positive Long id) {
        employeeService.deleteEmployee(id);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.STAFF_EMPLOYEE_DELETED));
    }

    @PostMapping(value = "/{id}/documents", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<ApiResponseDto<EmployeeDocumentResponseDto>> uploadDocument(
            @PathVariable @Positive Long id,
            @RequestParam MultipartFile file,
            @RequestParam String documentType
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.STAFF_DOCUMENT_UPLOADED,
                employeeService.uploadDocument(id, file, documentType)
        ));
    }

    @GetMapping("/{id}/documents")
    public ResponseEntity<ApiResponseDto<List<EmployeeDocumentResponseDto>>> getDocuments(
            @PathVariable @Positive Long id
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.STAFF_DOCUMENTS_RETRIEVED,
                employeeService.getDocuments(id)
        ));
    }

    @DeleteMapping("/{id}/documents/{documentId}")
    public ResponseEntity<ApiResponseDto<Void>> deleteDocument(
            @PathVariable @Positive Long id,
            @PathVariable @Positive Long documentId
    ) {
        employeeService.deleteDocument(id, documentId);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.STAFF_DOCUMENT_DELETED));
    }

    private Status parseStatus(String status) {
        if (!StringUtils.hasText(status)) {
            return null;
        }
        try {
            return Status.valueOf(status.trim().toUpperCase());
        } catch (IllegalArgumentException ex) {
            throw new BadRequestException(ErrorMessage.INVALID_STATUS, "INVALID_STATUS");
        }
    }
}
