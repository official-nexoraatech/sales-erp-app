package com.nexoraa.billtop.service;

import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.staff.EmployeeDocumentResponseDto;
import com.nexoraa.billtop.dto.staff.EmployeeRequestDto;
import com.nexoraa.billtop.dto.staff.EmployeeResponseDto;
import com.nexoraa.billtop.enums.Status;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

public interface StaffEmployeeService {

    void createEmployee(EmployeeRequestDto request);

    PageResponseDto<EmployeeResponseDto> getEmployees(int page, int size, String search, Status status, String department);

    EmployeeResponseDto getEmployeeById(Long id);

    void updateEmployee(Long id, EmployeeRequestDto request);

    void deleteEmployee(Long id);

    EmployeeDocumentResponseDto uploadDocument(Long employeeId, MultipartFile file, String documentType);

    List<EmployeeDocumentResponseDto> getDocuments(Long employeeId);

    void deleteDocument(Long employeeId, Long documentId);
}
