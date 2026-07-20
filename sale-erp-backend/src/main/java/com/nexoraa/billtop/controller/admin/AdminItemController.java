package com.nexoraa.billtop.controller.admin;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.item.ItemDetailResponseDto;
import com.nexoraa.billtop.dto.item.ItemListResponseDto;
import com.nexoraa.billtop.dto.item.ItemStockResponseDto;
import com.nexoraa.billtop.enums.ItemStatus;
import com.nexoraa.billtop.service.ItemService;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Positive;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Super Admin API (v2) for viewing items belonging to a specific organization.
 * Access is restricted to the "Super Admin" role via the SUPER_ADMIN authority.
 */
@Validated
@RestController
@RequestMapping("/api/v2/admin/organizations/{organizationId}/items")
@PreAuthorize("hasAuthority('SUPER_ADMIN')")
public class AdminItemController {

    private final ItemService itemService;

    public AdminItemController(ItemService itemService) {
        this.itemService = itemService;
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<PageResponseDto<ItemListResponseDto>>> getItems(
            @PathVariable @Positive Long organizationId,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Positive int size,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) Long categoryId,
            @RequestParam(required = false) Long brandId,
            @RequestParam(required = false) Long warehouseId,
            @RequestParam(required = false) ItemStatus status
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.ITEMS_RETRIEVED,
                itemService.getItemsForAdmin(organizationId, page, size, search, categoryId, brandId, warehouseId, status)
        ));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponseDto<ItemDetailResponseDto>> getItemById(
            @PathVariable @Positive Long organizationId,
            @PathVariable @Positive Long id,
            @RequestParam(required = false) Long warehouseId
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.ITEM_RETRIEVED,
                itemService.getItemByIdForOrganization(organizationId, id, warehouseId)
        ));
    }

    @GetMapping("/{id}/stock")
    public ResponseEntity<ApiResponseDto<ItemStockResponseDto>> getItemStock(
            @PathVariable @Positive Long organizationId,
            @PathVariable @Positive Long id
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.ITEM_STOCK_RETRIEVED,
                itemService.getItemStockForOrganization(organizationId, id)
        ));
    }
}
