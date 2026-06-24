package com.nexoraa.billtop.service.impl;

import com.nexoraa.billtop.constants.ErrorMessage;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.common.FileUploadResponseDto;
import com.nexoraa.billtop.dto.staff.EmployeeDocumentResponseDto;
import com.nexoraa.billtop.dto.staff.EmployeeRequestDto;
import com.nexoraa.billtop.dto.staff.EmployeeResponseDto;
import com.nexoraa.billtop.entity.Employee;
import com.nexoraa.billtop.entity.Organization;
import com.nexoraa.billtop.entity.StaffEmployeeDocument;
import com.nexoraa.billtop.enums.Status;
import com.nexoraa.billtop.exception.BadRequestException;
import com.nexoraa.billtop.exception.ResourceNotFoundException;
import com.nexoraa.billtop.repository.EmployeeRepository;
import com.nexoraa.billtop.repository.StaffEmployeeDocumentRepository;
import com.nexoraa.billtop.security.CurrentOrganizationService;
import com.nexoraa.billtop.service.FileStorageService;
import com.nexoraa.billtop.service.StaffEmployeeService;
import com.nexoraa.billtop.specification.StaffSpecification;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

import java.math.BigDecimal;
import java.util.List;

@Service
public class StaffEmployeeServiceImpl implements StaffEmployeeService {

    private static final BigDecimal ZERO = BigDecimal.ZERO;

    private final EmployeeRepository employeeRepository;
    private final StaffEmployeeDocumentRepository documentRepository;
    private final FileStorageService fileStorageService;
    private final CurrentOrganizationService currentOrganizationService;

    public StaffEmployeeServiceImpl(
            EmployeeRepository employeeRepository,
            StaffEmployeeDocumentRepository documentRepository,
            FileStorageService fileStorageService,
            CurrentOrganizationService currentOrganizationService
    ) {
        this.employeeRepository = employeeRepository;
        this.documentRepository = documentRepository;
        this.fileStorageService = fileStorageService;
        this.currentOrganizationService = currentOrganizationService;
    }

    @Override
    @Transactional
    public void createEmployee(EmployeeRequestDto request) {
        Organization organization = currentOrganizationService.getOrganizationReference();
        Long organizationId = organization.getId();
        if (employeeRepository.existsByEmployeeCodeIgnoreCaseAndOrganizationIdAndIsDeletedFalse(
                request.getEmployeeCode(),
                organizationId
        )) {
            throw new BadRequestException(ErrorMessage.STAFF_EMPLOYEE_ALREADY_EXISTS, "STAFF_EMPLOYEE_ALREADY_EXISTS");
        }

        Employee employee = new Employee();
        employee.setOrganization(organization);
        applyRequest(request, employee);
        employeeRepository.save(employee);
    }

    @Override
    @Transactional(readOnly = true)
    public PageResponseDto<EmployeeResponseDto> getEmployees(
            int page,
            int size,
            String search,
            Status status,
            String department
    ) {
        Specification<Employee> specification = StaffSpecification.<Employee>organization(currentOrganizationService.getOrganizationId())
                .and(StaffSpecification.notDeleted())
                .and(StaffSpecification.employeeSearch(search))
                .and(StaffSpecification.employeeStatus(status))
                .and(StaffSpecification.employeeDepartment(department));
        Page<Employee> employees = employeeRepository.findAll(
                specification,
                PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "id"))
        );
        return PageResponseDto.from(employees.map(this::toResponse));
    }

    @Override
    @Transactional(readOnly = true)
    public EmployeeResponseDto getEmployeeById(Long id) {
        return toResponse(getEmployee(id));
    }

    @Override
    @Transactional
    public void updateEmployee(Long id, EmployeeRequestDto request) {
        Employee employee = getEmployee(id);
        Long organizationId = currentOrganizationService.getOrganizationId();
        if (employeeRepository.existsByEmployeeCodeIgnoreCaseAndIdNotAndOrganizationIdAndIsDeletedFalse(
                request.getEmployeeCode(),
                id,
                organizationId
        )) {
            throw new BadRequestException(ErrorMessage.STAFF_EMPLOYEE_ALREADY_EXISTS, "STAFF_EMPLOYEE_ALREADY_EXISTS");
        }
        applyRequest(request, employee);
        employeeRepository.save(employee);
    }

    @Override
    @Transactional
    public void deleteEmployee(Long id) {
        Employee employee = getEmployee(id);
        employee.setStatus(Status.INACTIVE);
        employee.setIsDeleted(true);
        employeeRepository.save(employee);
    }

    @Override
    @Transactional
    public EmployeeDocumentResponseDto uploadDocument(Long employeeId, MultipartFile file, String documentType) {
        if (!StringUtils.hasText(documentType)) {
            throw new BadRequestException(ErrorMessage.BAD_REQUEST, "DOCUMENT_TYPE_REQUIRED");
        }
        Employee employee = getEmployee(employeeId);
        Organization organization = currentOrganizationService.getOrganizationReference();
        Long organizationId = organization.getId();
        FileUploadResponseDto upload = fileStorageService.uploadFile(
                file,
                "organizations/" + organizationId + "/staff/employees/" + employeeId + "/documents"
        );

        StaffEmployeeDocument document = StaffEmployeeDocument.builder()
                .organization(organization)
                .employee(employee)
                .documentType(documentType)
                .fileName(upload.getFileName())
                .objectKey(upload.getObjectKey())
                .objectUrl(upload.getObjectUrl())
                .contentType(upload.getContentType())
                .fileSize(upload.getSize())
                .build();
        return toDocumentResponse(documentRepository.save(document));
    }

    @Override
    @Transactional(readOnly = true)
    public List<EmployeeDocumentResponseDto> getDocuments(Long employeeId) {
        getEmployee(employeeId);
        return documentRepository.findByEmployeeIdAndOrganizationIdAndIsDeletedFalseOrderByCreatedAtDesc(
                        employeeId,
                        currentOrganizationService.getOrganizationId()
                )
                .stream()
                .map(this::toDocumentResponse)
                .toList();
    }

    @Override
    @Transactional
    public void deleteDocument(Long employeeId, Long documentId) {
        getEmployee(employeeId);
        StaffEmployeeDocument document = documentRepository.findByIdAndEmployeeIdAndOrganizationIdAndIsDeletedFalse(
                        documentId,
                        employeeId,
                        currentOrganizationService.getOrganizationId()
                )
                .orElseThrow(() -> new ResourceNotFoundException(
                        ErrorMessage.STAFF_DOCUMENT_NOT_FOUND,
                        "STAFF_DOCUMENT_NOT_FOUND"
                ));
        document.setIsDeleted(true);
        documentRepository.save(document);
    }

    private Employee getEmployee(Long id) {
        return employeeRepository.findByIdAndOrganizationIdAndIsDeletedFalse(
                        id,
                        currentOrganizationService.getOrganizationId()
                )
                .orElseThrow(() -> new ResourceNotFoundException(
                        ErrorMessage.STAFF_EMPLOYEE_NOT_FOUND,
                        "STAFF_EMPLOYEE_NOT_FOUND"
                ));
    }

    private void applyRequest(EmployeeRequestDto request, Employee employee) {
        employee.setEmployeeCode(request.getEmployeeCode());
        employee.setFirstName(request.getFirstName());
        employee.setLastName(request.getLastName());
        employee.setGender(request.getGender());
        employee.setDob(request.getDob());
        employee.setMobile(request.getMobile());
        employee.setEmail(request.getEmail());
        employee.setAddress(request.getAddress());
        employee.setDepartment(request.getDepartment());
        employee.setDesignation(request.getDesignation());
        employee.setJoiningDate(request.getJoiningDate());
        employee.setEmploymentType(request.getEmploymentType());
        employee.setReportingManager(request.getReportingManager());
        employee.setBasicSalary(defaultZero(request.getBasicSalary()));
        employee.setHra(defaultZero(request.getHra()));
        employee.setAllowance(defaultZero(request.getAllowance()));
        employee.setDeductions(defaultZero(request.getDeductions()));
        employee.setPaymentMode(request.getPaymentMode());
        employee.setBankName(request.getBankName());
        employee.setAccountNumber(request.getAccountNumber());
        employee.setIfscCode(request.getIfscCode());
        employee.setAccountHolderName(request.getAccountHolderName());
        employee.setStatus(request.getStatus());
    }

    private EmployeeResponseDto toResponse(Employee employee) {
        return EmployeeResponseDto.builder()
                .id(employee.getId())
                .employeeCode(employee.getEmployeeCode())
                .firstName(employee.getFirstName())
                .lastName(employee.getLastName())
                .gender(employee.getGender())
                .dob(employee.getDob())
                .mobile(employee.getMobile())
                .email(employee.getEmail())
                .address(employee.getAddress())
                .department(employee.getDepartment())
                .designation(employee.getDesignation())
                .joiningDate(employee.getJoiningDate())
                .employmentType(employee.getEmploymentType())
                .reportingManager(employee.getReportingManager())
                .basicSalary(defaultZero(employee.getBasicSalary()))
                .hra(defaultZero(employee.getHra()))
                .allowance(defaultZero(employee.getAllowance()))
                .deductions(defaultZero(employee.getDeductions()))
                .paymentMode(employee.getPaymentMode())
                .bankName(employee.getBankName())
                .accountNumber(employee.getAccountNumber())
                .ifscCode(employee.getIfscCode())
                .accountHolderName(employee.getAccountHolderName())
                .status(employee.getStatus())
                .createdAt(employee.getCreatedAt())
                .build();
    }

    private EmployeeDocumentResponseDto toDocumentResponse(StaffEmployeeDocument document) {
        return EmployeeDocumentResponseDto.builder()
                .id(document.getId())
                .employeeId(document.getEmployee().getId())
                .documentType(document.getDocumentType())
                .fileName(document.getFileName())
                .objectKey(document.getObjectKey())
                .objectUrl(document.getObjectUrl())
                .contentType(document.getContentType())
                .size(document.getFileSize())
                .createdAt(document.getCreatedAt())
                .build();
    }

    private BigDecimal defaultZero(BigDecimal value) {
        return value == null ? ZERO : value;
    }
}
