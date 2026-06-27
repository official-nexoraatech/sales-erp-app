package com.nexoraa.billtop.controller;

import com.nexoraa.billtop.constants.ResponseMessage;
import com.nexoraa.billtop.dto.ApiResponseDto;
import com.nexoraa.billtop.dto.PageResponseDto;
import com.nexoraa.billtop.dto.item.ItemDetailResponseDto;
import com.nexoraa.billtop.dto.item.ItemListResponseDto;
import com.nexoraa.billtop.dto.item.ItemRequestDto;
import com.nexoraa.billtop.dto.item.ItemStockResponseDto;
import com.nexoraa.billtop.dto.item.excel.ItemExcelImportResponseDto;
import com.nexoraa.billtop.service.ItemExcelService;
import com.nexoraa.billtop.service.ItemService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Positive;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
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

@Validated
@RestController
@RequestMapping("/api/v1/items")
public class ItemController {

    private final ItemService itemService;
    private final ItemExcelService itemExcelService;

    public ItemController(ItemService itemService, ItemExcelService itemExcelService) {
        this.itemService = itemService;
        this.itemExcelService = itemExcelService;
    }

    @GetMapping("/excel/template")
    public ResponseEntity<byte[]> downloadItemImportTemplate() {
        byte[] file = itemExcelService.generateTemplate();
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + ItemExcelService.TEMPLATE_FILE_NAME + "\"")
                .contentType(MediaType.parseMediaType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
                .body(file);
    }

    @PostMapping(value = "/excel/import", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<ApiResponseDto<ItemExcelImportResponseDto>> importItemsFromExcel(
            @RequestParam MultipartFile file,
            @RequestParam @Positive Long warehouseId,
            @RequestParam @Positive Long baseUnitId
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                "Items imported successfully",
                itemExcelService.importItems(file, warehouseId, baseUnitId)
        ));
    }

    @PostMapping
    public ResponseEntity<ApiResponseDto<Void>> createItem(
            @Valid @RequestBody ItemRequestDto request
    ) {
        itemService.createItem(request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.ITEM_CREATED));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponseDto<ItemDetailResponseDto>> getItemById(@PathVariable @Positive Long id) {
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.ITEM_RETRIEVED, itemService.getItemById(id)));
    }

    @GetMapping
    public ResponseEntity<ApiResponseDto<PageResponseDto<ItemListResponseDto>>> getItems(
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "20") @Positive int size,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) Long categoryId,
            @RequestParam(required = false) Long brandId,
            @RequestParam(required = false) Long warehouseId
    ) {
        return ResponseEntity.ok(ApiResponseDto.success(
                ResponseMessage.ITEMS_RETRIEVED,
                itemService.getItems(page, size, search, categoryId, brandId, warehouseId)
        ));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> updateItem(
            @PathVariable @Positive Long id,
            @Valid @RequestBody ItemRequestDto request
    ) {
        itemService.updateItem(id, request);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.ITEM_UPDATED));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponseDto<Void>> deleteItem(@PathVariable @Positive Long id) {
        itemService.deleteItem(id);
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.ITEM_DELETED));
    }

    @GetMapping("/{id}/stock")
    public ResponseEntity<ApiResponseDto<ItemStockResponseDto>> getItemStock(@PathVariable @Positive Long id) {
        return ResponseEntity.ok(ApiResponseDto.success(ResponseMessage.ITEM_STOCK_RETRIEVED, itemService.getItemStock(id)));
    }
}
