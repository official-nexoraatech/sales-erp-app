package com.nexoraa.billtop.controller.admin;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.report.StockReportResponseDto;
import com.nexoraa.billtop.service.ReportService;
import jakarta.validation.constraints.Positive;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Super Admin API (v2) for viewing stock belonging to a specific organization.
 * Access is restricted to the "Super Admin" role via the SUPER_ADMIN authority.
 */
@Validated
@RestController
@RequestMapping("/api/v2/admin/organizations/{organizationId}/stock")
@PreAuthorize("hasAuthority('SUPER_ADMIN')")
public class AdminStockController {

    private final ReportService reportService;

    public AdminStockController(ReportService reportService) {
        this.reportService = reportService;
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<List<StockReportResponseDto>>> getStock(
            @PathVariable @Positive Long organizationId
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.REPORT_RETRIEVED,
                reportService.getStockReportForOrganization(organizationId)
        ));
    }

    @GetMapping("/low-stock")
    public ResponseEntity<ApiResponseDto<List<StockReportResponseDto>>> getLowStock(
            @PathVariable @Positive Long organizationId
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.REPORT_RETRIEVED,
                reportService.getLowStockReportForOrganization(organizationId)
        ));
    }
}
